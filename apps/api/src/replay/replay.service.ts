// ReplayService — runs a replay of a prior inference.
//
// Steps: (1) load the source user-scoped (cross-user → not found → 404);
// (2) gate on eligibility (ineligible → 400); (3) reconstruct the input from
// the source conversation; (4) persist a kind='replay' placeholder via
// ChatService.startTurn (self-FK to the source, inheriting any sample
// workspace); (5) drive a StreamOrchestrator against the target provider,
// registered in the OrchestratorRegistry so Clear can cancel it. Returns the
// new ids immediately; the diff is computed later (the run streams async).
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ReplayRunResponse } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { ChatService } from '../chat/chat.service';
import { SeqCounterRegistry } from '../chat/seq-counter';
import { StreamOrchestrator } from '../chat/stream-orchestrator';
import { OrchestratorRegistry } from '../orchestrator/registry';
import type { OrchestratorHandle } from '../orchestrator/handle';
import { SDK_CHAT_TOKEN, type SdkChat } from '../common/sdk';
import { captureApiError } from '../observability/sentry';
import { replayEligibility } from './replay-eligibility';
import { reconstructReplayInput, type ReplayHistoryMessage } from './replay-input-reconstructor';

export class IneligibleReplayError extends Error {
  constructor(public readonly sourceInferenceId: string) {
    super('Source inference is not eligible for replay');
    this.name = 'IneligibleReplayError';
  }
}

export class ReplaySourceNotFoundError extends Error {
  constructor(public readonly sourceInferenceId: string) {
    super('Replay source not found');
    this.name = 'ReplaySourceNotFoundError';
  }
}

export interface ReplayRunInput {
  userId: string;
  sourceInferenceId: string;
  provider: string;
  model: string;
}

/** Hard ceiling on a single replay run. Past this the orchestrator is canceled
 *  so a stalled provider stream can't strand the turn in `streaming` forever.
 *  Comfortably above a normal replay (seconds) but bounded for the UI poll. */
const REPLAY_MAX_DURATION_MS = 45_000;

interface SourceRow {
  id: string;
  messageId: string;
  conversationId: string;
  status: string;
  sampleWorkspaceId: string | null;
}

interface MessageRow {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly seqRegistry: SeqCounterRegistry,
    private readonly registry: OrchestratorRegistry,
    @Inject(SDK_CHAT_TOKEN) private readonly sdk: SdkChat,
  ) {}

  async run(input: ReplayRunInput): Promise<ReplayRunResponse> {
    // (1) user-scoped source load — defense in depth (controller also 404s).
    const source = (await this.prisma.db.inference.findFirst({
      where: { id: input.sourceInferenceId, userId: input.userId },
    })) as unknown as SourceRow | null;
    if (!source) throw new ReplaySourceNotFoundError(input.sourceInferenceId);

    // (2) eligibility gate.
    if (replayEligibility(source.status) === 'ineligible') {
      throw new IneligibleReplayError(input.sourceInferenceId);
    }

    // (3) reconstruct the input from the source conversation.
    const rows = (await this.prisma.db.message.findMany({
      where: { conversationId: source.conversationId, userId: input.userId },
      orderBy: { createdAt: 'asc' },
    })) as unknown as MessageRow[];
    const history: ReplayHistoryMessage[] = rows.map((m) => ({
      id: m.id,
      role: m.role as ReplayHistoryMessage['role'],
      content: m.content,
      createdAt: m.createdAt,
    }));
    const assistantMsg = history.find((m) => m.id === source.messageId);
    const boundary = assistantMsg ? assistantMsg.createdAt.getTime() : Number.MAX_SAFE_INTEGER;
    const triggering =
      [...history].filter((m) => m.role === 'user' && m.createdAt.getTime() <= boundary).pop() ??
      history.filter((m) => m.role === 'user').pop();
    if (!triggering) throw new ReplaySourceNotFoundError(input.sourceInferenceId);

    const reconstructed = reconstructReplayInput({
      source: { conversationId: source.conversationId },
      triggeringUserMessage: triggering,
      history,
    });

    // (4) persist the replay placeholder (self-FK + inherited sample workspace).
    const { assistantMessageId } = await this.chat.startTurn({
      userId: input.userId,
      conversationId: source.conversationId,
      userMessageContent: reconstructed.userMessage.content,
      kind: 'replay',
      replayOfInferenceId: source.id,
      sampleWorkspaceId: source.sampleWorkspaceId ?? undefined,
    });
    const newInf = (await this.prisma.db.inference.findFirst({
      where: { messageId: assistantMessageId, kind: 'replay' },
    })) as unknown as { id: string } | null;

    // (5) drive the orchestrator against the target provider, registered so
    // Clear's cancelAll can stop it. No WS client to emit to — frames are
    // discarded; the result surfaces via Traces / Replay refetch.
    const sdkMessages = [
      ...(reconstructed.system ? [{ role: 'system' as const, content: reconstructed.system }] : []),
      ...reconstructed.history,
    ];
    const abort = new AbortController();
    const sdkStream = this.sdk.stream({
      messages: sdkMessages,
      conversationId: source.conversationId,
      turnIndex: 0,
      userId: input.userId,
      messageId: assistantMessageId,
      signal: abort.signal,
      // REVIEW-BRIEF Finding 5 (R1): the router targets a specific adapter ONLY
      // via `req.pin` — it never reads the `provider`/`model` hint fields (those
      // are ignored by the SDK). Passing them as a pin makes the override branch
      // route to the chosen provider and surface "not configured" inline when it
      // isn't, instead of silently re-running against the default router head.
      pin: { provider: input.provider, model: input.model },
    });
    const orchestrator = new StreamOrchestrator(this.chat, this.seqRegistry, {
      messageId: assistantMessageId,
      conversationId: source.conversationId,
      // provider/model removed from RunStreamInput in the chat-context merge
      // (PR #5 LLD Task 41 — the orchestrator reads them off the SDK `commit`
      // chunk). The intended provider/model are still threaded onto the SDK
      // request above, and the SDK surfaces the committed pair on its chunk.
      sdkStream,
      abort,
      emit: () => undefined,
    });
    const handle: OrchestratorHandle = {
      messageId: assistantMessageId,
      kind: 'replay',
      cancel: () => orchestrator.cancel(),
    };
    this.registry.register(input.userId, handle);
    // Safety timeout: a replay stream that stalls (provider hang, etc.) would
    // otherwise leave the message stuck in `streaming` forever — the console
    // polls the detail for the diff and would never resolve (it would just
    // "keep loading"). Cancel the orchestrator after a bound so the turn
    // finalizes (`canceled`), which makes the diff computable and lets the UI
    // surface a result instead of spinning. Cleared on normal completion;
    // `cancel()` is idempotent (no-op once a terminal has been reached). The
    // timer is unref'd so it never keeps the process (or a test) alive.
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      this.logger.warn(
        `replay.run.timeout messageId=${assistantMessageId} provider=${input.provider} model=${input.model} — canceling stalled stream`,
      );
      void orchestrator.cancel();
    }, REPLAY_MAX_DURATION_MS);
    (timeout as { unref?: () => void }).unref?.();
    this.logger.debug(
      `replay.run.start messageId=${assistantMessageId} inferenceId=${newInf?.id} provider=${input.provider} model=${input.model} historyMsgs=${sdkMessages.length}`,
    );
    void orchestrator
      .runStream()
      .then(() =>
        this.logger.debug(`replay.run.done messageId=${assistantMessageId}`),
      )
      .catch((err) => {
        // VISIBLE log in addition to Sentry — captureApiError is a no-op
        // without SENTRY_DSN, which silently hid replay failures in local dev.
        this.logger.error(
          `replay.run.error messageId=${assistantMessageId}: ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }`,
        );
        captureApiError({
          err,
          feature: 'replay',
          layer: 'service',
          extra: { stage: 'runStream', messageId: assistantMessageId },
        });
      })
      .finally(() => {
        clearTimeout(timeout);
        this.registry.deregister(input.userId, assistantMessageId);
      });

    return {
      messageId: assistantMessageId,
      inferenceId: newInf?.id ?? assistantMessageId,
      conversationId: source.conversationId,
      // Computed later once the replay output lands (the run streams async).
      diff: null,
    };
  }
}
