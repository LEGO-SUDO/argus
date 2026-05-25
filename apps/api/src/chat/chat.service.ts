// ChatService — owns message_id minting and the messages.status column.
//
// Per HLD D1 + LLD Open Question (Transactional boundary for startTurn):
//
//   startTurn:
//     - mints assistant message_id
//     - in a single Prisma transaction:
//         INSERT user message (status='complete')
//         INSERT assistant message (status='streaming')
//         UPDATE conversation.last_message_at
//         INSERT placeholder inferences row keyed by message_id (status='streaming',
//                provider='pending', model='pending', token counts null)
//     - returns the assistant message_id; the caller invokes SDK afterward.
//
//   completeTurn / cancelTurn / failTurn:
//     - update only `messages` columns; never touch `inferences` (the
//       projection consumer enriches that placeholder row via OTel ingestion).
//
// Why provider='pending' on the placeholder: the InferenceStatus enum has no
// 'pending', so we use 'streaming' on the row and use literal sentinel strings
// for provider/model. The projection consumer will overwrite both fields when
// the OTel span lands. If the span never lands (provider crash), the row
// remains visible with status='streaming' which Phase B reads can surface as
// "incomplete inference".
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { InferenceKind } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';

export interface StartTurnInput {
  userId: string;
  conversationId: string;
  userMessageContent: string;
  /**
   * Optional pre-minted assistant message id. The gateway mints early so
   * pre-startTurn error frames can carry the same messageId the web client
   * will eventually see on a happy-path `start` frame — this keeps WS
   * error correlation consistent across all failure points.
   * When omitted, ChatService mints internally (preserves the original
   * single-call API for non-gateway callers).
   */
  assistantMessageId?: string;
  /**
   * Phase B: classifies the placeholder inference row. Defaults to `chat`.
   * Replay runs pass `replay`, Generate-Samples passes `sample`.
   */
  kind?: InferenceKind;
  /** Phase B: FK to the user message a `classifier` row was triggered by. */
  classifierMessageId?: string;
  /** Phase B: self-FK to the source inference a `replay` row re-runs. */
  replayOfInferenceId?: string;
  /** Phase B: FK to the sample workspace a `sample` (or inherited replay) row belongs to. */
  sampleWorkspaceId?: string;
  /**
   * chat-context-and-ux-polish (integration review — first-turn pin race).
   * Optional pin carried on the WS `send` frame. When present, it is persisted
   * onto the conversation row INSIDE the startTurn transaction (atomic with the
   * message inserts, scoped by userId like every other conversations write) so
   * turn 2+ flow through the existing persisted-pin path. The gateway validates
   * the pin against the live catalog BEFORE calling startTurn, so this is
   * trusted by the time it reaches here. The returned pin pair reflects the
   * just-persisted value.
   */
  pin?: { provider: string; model: string };
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StartTurnResult {
  userMessageId: string;
  assistantMessageId: string;
  // chat-context-and-ux-polish LLD Task 53 — multi-turn history (oldest
  // first, streaming rows excluded) the gateway threads into the SDK
  // request's `messages` field so the model actually sees prior turns.
  history?: ChatHistoryMessage[];
  // LLD Task 53 — pin pair from the conversation row, surfaced here so the
  // gateway can build the SDK request's `pin` without a second query.
  pinnedProvider?: string | null;
  pinnedModel?: string | null;
}

/**
 * Thrown when startTurn is called with a (conversationId, userId) pair that
 * does not exist or does not belong to the caller. The gateway already does
 * its own ownership check before invoking startTurn (see ChatGateway.handleSend),
 * but the service repeats it as a defensive guard — a service that trusts its
 * callers is a footgun for anyone wiring it up from a non-gateway path
 * (background jobs, REST endpoints, future RPC).
 */
export class ConversationNotOwnedError extends Error {
  constructor(public readonly conversationId: string) {
    super('Conversation not found for user');
    this.name = 'ConversationNotOwnedError';
  }
}

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  mintMessageId(): string {
    return randomUUID();
  }

  async startTurn(input: StartTurnInput): Promise<StartTurnResult> {
    // Defense-in-depth: never write user/assistant/inference rows against a
    // conversation the caller does not own. Done before minting ids so a
    // malicious or buggy caller cannot allocate UUIDs against a foreign
    // conversation.
    const conv = await this.prisma.db.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
    });
    if (!conv) {
      throw new ConversationNotOwnedError(input.conversationId);
    }

    const userMessageId = this.mintMessageId();
    const assistantMessageId = input.assistantMessageId ?? this.mintMessageId();
    const now = new Date();

    // chat-context-and-ux-polish (Codex review — concurrent-sends history
    // contamination). The user-message insert AND the history read MUST live
    // in the SAME transaction. Previously the history read ran in a separate
    // query after the transaction committed, so two concurrent sends on the
    // same conversation could interleave: send-B's user message could land
    // between send-A's insert and send-A's read, polluting send-A's threaded
    // history with send-B's not-yet-its-turn user message. Reading inside the
    // transaction sees only this turn's own insert plus all committed-before
    // messages (the in-flight peer's insert is in a separate, uncommitted
    // transaction and is therefore invisible).
    const txResult = await this.prisma.db.$transaction(async (tx) => {
      // 1. User message — status `complete` immediately; nothing further
      //    happens to it.
      await tx.message.create({
        data: {
          id: userMessageId,
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'user',
          content: input.userMessageContent,
          status: 'complete',
          completedAt: now,
        },
      });
      // 2. Assistant message — placeholder with empty content; the
      //    StreamOrchestrator flushes content on terminal frame.
      await tx.message.create({
        data: {
          id: assistantMessageId,
          conversationId: input.conversationId,
          userId: input.userId,
          role: 'assistant',
          content: '',
          status: 'streaming',
        },
      });
      // 3. Conversation last_message_at — keeps the sidebar ordering fresh.
      //    updateMany so we can scope by userId for safety (cannot rename a
      //    cross-user conversation; if updateMany returns 0 the request
      //    should have failed earlier in the gateway authz check).
      await tx.conversation.updateMany({
        where: { id: input.conversationId, userId: input.userId },
        data: { lastMessageAt: now },
      });
      // 4. Placeholder inferences row — outbox-pattern. Projection consumer
      //    enriches via OTel span (message.id attribute join).
      await tx.inference.create({
        data: {
          messageId: assistantMessageId,
          conversationId: input.conversationId,
          userId: input.userId,
          provider: 'pending',
          model: 'pending',
          status: 'streaming',
          // Phase B linkage — defaults to a plain `chat` row with null FKs so
          // Phase A callers are unaffected; replay/sample/classifier callers
          // set the kind + the matching FK column.
          kind: input.kind ?? 'chat',
          classifierForMessageId: input.classifierMessageId ?? null,
          replayOfInferenceId: input.replayOfInferenceId ?? null,
          sampleWorkspaceId: input.sampleWorkspaceId ?? null,
          startedAt: now,
        },
      });

      // 4b. chat-context-and-ux-polish (integration review — first-turn pin
      //     race). Persist the send-frame pin onto the conversation row INSIDE
      //     the transaction so it's atomic with the message inserts. updateMany
      //     scoped by (id, userId) so the write respects the same ownership
      //     guard as every other conversations write (and is a no-op for a
      //     foreign conversation — though startTurn already authz-checked
      //     above). Persisting here means the re-read in step 6 returns the
      //     fresh pin, and turn 2+ pick it up via the persisted-pin path.
      if (input.pin) {
        await tx.conversation.updateMany({
          where: { id: input.conversationId, userId: input.userId },
          data: {
            pinnedProvider: input.pin.provider,
            pinnedModel: input.pin.model,
          },
        });
      }

      // 5. LLD Task 53 — load the multi-turn history INSIDE the transaction,
      //    after the user-message insert, so the new user message is included
      //    but a concurrent peer's user message is NOT. Streaming-status rows
      //    are excluded — the assistant placeholder we just inserted is still
      //    streaming, and any crashed prior assistant row would otherwise leak
      //    empty/partial content into the next prompt. Order: chronological.
      const historyRows = (await tx.message.findMany({
        where: {
          conversationId: input.conversationId,
          userId: input.userId,
          status: { in: ['complete', 'canceled', 'failed'] },
        },
        orderBy: { createdAt: 'asc' },
      })) as Array<{ role: string; content: string }>;

      // 6. Re-read the conversation row (already authz-checked above) for the
      //    pin pair so the gateway doesn't need a second query — inside the
      //    transaction for a consistent snapshot.
      const pinned = (await tx.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
      })) as { pinnedProvider?: string | null; pinnedModel?: string | null } | null;

      return { historyRows, pinned };
    });

    const history: ChatHistoryMessage[] = txResult.historyRows.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    return {
      userMessageId,
      assistantMessageId,
      history,
      pinnedProvider: txResult.pinned?.pinnedProvider ?? null,
      pinnedModel: txResult.pinned?.pinnedModel ?? null,
    };
  }

  async completeTurn(messageId: string, content: string): Promise<void> {
    await this.prisma.db.message.update({
      where: { id: messageId },
      data: {
        content,
        status: 'complete',
        completedAt: new Date(),
      },
    });
  }

  async cancelTurn(messageId: string, partialContent: string): Promise<void> {
    await this.prisma.db.message.update({
      where: { id: messageId },
      data: {
        content: partialContent,
        status: 'canceled',
        completedAt: new Date(),
      },
    });
  }

  /**
   * Mark a streaming message as failed and flush any partial content.
   *
   * Also writes `errorCode` + `status='failed'` into the placeholder
   * `inferences` row keyed by message_id, so the conversations history hydrate
   * (MessagesRepository.listForConversation) can surface the code on
   * MessageDto.errorCode — frontend-web's "interrupted" marker + Retry button
   * (Tasks 45/46) keys off that field.
   *
   * The projection consumer normally enriches the inferences row from the OTel
   * span, but when the API itself terminates a stream (disconnect, SDK error,
   * cancel) the span may never land — we must persist the error code locally
   * so history fetch is correct even on a cold start with no consumer.
   *
   * `updateMany` (not `update`) so a missing inferences row (defensive — should
   * exist from startTurn) is a no-op rather than a throw.
   */
  async failTurn(messageId: string, partialContent: string, errorCode: string): Promise<void> {
    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: {
          content: partialContent,
          status: 'failed',
          completedAt: now,
        },
      });
      await tx.inference.updateMany({
        where: { messageId },
        data: {
          errorCode,
          status: 'failed',
          endedAt: now,
        },
      });
    });
  }
}
