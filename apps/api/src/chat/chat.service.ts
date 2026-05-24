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
}

export interface StartTurnResult {
  userMessageId: string;
  assistantMessageId: string;
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

    await this.prisma.db.$transaction(async (tx) => {
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
    });

    return { userMessageId, assistantMessageId };
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
