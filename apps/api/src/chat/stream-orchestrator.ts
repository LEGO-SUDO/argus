// StreamOrchestrator — the only call site for packages/sdk's chat.stream.
//
// Lifecycle (chat-context-and-ux-polish backbone, LLD Tasks 40-47 / 56-59):
//   runStream({ messageId, sdkStream, emit, conversationId, userId?, meter? })
//     1. emit(start) — identity-only at seq=0 (LLD Task 2/41)
//     2. on SDK `commit` chunk → emit(metadata) EXACTLY ONCE at seq=1
//        from the commit payload (LLD Preamble §2, Task 41/43).
//     3. for each token in sdkStream — emit(token), accumulate content
//     4. on done — completeTurn(content), invoke meter inside try/catch
//        (LLD Task 57), emit(end status='complete' [+ context fields]), release
//     5. on cancel() — abort sdk iterator, cancelTurn(partial),
//                       emit(cancel-ack), emit(end status='canceled'), release.
//                       Meter intentionally NOT invoked (LLD Task 59).
//     6. on onDisconnect() — abort, failTurn(partial, 'client_disconnected'),
//                             do NOT emit further (socket is gone)
//     7. on SDK throw — failTurn(partial, code), emit(error),
//                        emit(end status='failed'). Pre-token error path
//                        ships NO metadata frame (LLD Preamble §3).
//
// The orchestrator owns a single AbortController per invocation;
// sdkStream.signal is the same controller's signal.
import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import type { ChatStreamChunk, ProviderMeta } from '@argus/sdk';
import { ChatService } from './chat.service';
import { SeqCounterRegistry } from './seq-counter';
import {
  buildCancelAckFrame,
  buildEndFrame,
  buildErrorFrame,
  buildMetadataFrame,
  buildStartFrame,
  buildTokenFrame,
} from './frame-builder';
import type { WsFrameOutbound } from '@argus/contracts';
import { captureApiError } from '../observability/sentry';
import type { ContextMeterService, ContextMeterReadout } from './context-meter.service';

/** What the orchestrator emits — gateway forwards over WS, tests assert on it. */
export type Emit = (frame: WsFrameOutbound) => void;

export interface RunStreamInput {
  messageId: string;
  conversationId: string;
  // chat-context-and-ux-polish LLD Task 41 — provider/model removed from the
  // orchestrator input shape. The SDK now ships a `commit` chunk before the
  // first token (LLD Preamble §1) and the orchestrator emits a `metadata`
  // frame from that chunk. The gateway no longer threads literal mock-1
  // labels into the start frame.
  sdkStream: AsyncIterable<ChatStreamChunk>;
  /** Surface the underlying AbortController so we can stop the SDK iterator. */
  abort: AbortController;
  emit: Emit;
  // chat-context-and-ux-polish LLD Task 57 — meter (+ userId for the
  // meter's authz). Both optional so the orchestrator stays buildable from
  // callers that don't have a meter wired (tests, future RPC entry points).
  userId?: string;
  meter?: ContextMeterService;
}

type Terminal = 'complete' | 'canceled' | 'failed' | 'disconnected';

export class StreamOrchestrator {
  private static readonly logger = new Logger(StreamOrchestrator.name);
  private terminal: Terminal | null = null;
  private partialContent = '';
  // chat-context-and-ux-polish LLD Task 43 — exactly-once metadata guard.
  // Even if the SDK defensively yields two `commit` chunks (router has its
  // own guard, but defense-in-depth here too) the orchestrator must emit
  // metadata exactly once (Preamble §2).
  private metadataEmitted = false;
  private committedProviderMeta: ProviderMeta | null = null;

  constructor(
    private readonly chat: ChatService,
    private readonly seqRegistry: SeqCounterRegistry,
    private readonly input: RunStreamInput,
  ) {}

  /**
   * Drive the SDK iterator to completion. Resolves when the terminal frame
   * has been emitted (or when disconnect has been observed — in which case
   * no end frame is emitted).
   */
  async runStream(): Promise<void> {
    const counter = this.seqRegistry.for(this.input.messageId);

    // Start frame — seq 0, identity-only (LLD Task 2/37). The metadata frame
    // (LLD Task 4/41) lands at seq=1 after the SDK commits to a provider.
    counter.next(); // consume 0
    this.emit(
      buildStartFrame({
        messageId: this.input.messageId,
        conversationId: this.input.conversationId,
      }),
    );

    let providerMeta: ProviderMeta | null = null;

    try {
      for await (const chunk of this.input.sdkStream) {
        // Race guard #1: if we've already entered a terminal state (cancel /
        // disconnect arrived between iterator yields), drop the chunk before
        // we mutate any state or emit.
        if (this.terminal !== null) return;
        if (chunk.type === 'commit') {
          // LLD Task 41 — emit metadata frame EXACTLY ONCE per turn from the
          // commit chunk's providerMeta. Subsequent commits coalesce
          // (Task 43 guard); the seq counter must NOT advance on the dropped
          // duplicates.
          if (this.metadataEmitted) continue;
          this.metadataEmitted = true;
          this.committedProviderMeta = chunk.providerMeta;
          const metaSeq = counter.next(); // consume 1
          if (metaSeq !== 1) {
            // Defensive — should be guaranteed by the start@0 advance above.
            // Capture but proceed; the wire-side schema pins seq=1.
            captureApiError({
              err: new Error('metadata seq drift'),
              feature: 'chat',
              layer: 'orchestrator',
              extra: { messageId: this.input.messageId, observedSeq: String(metaSeq) },
            });
          }
          // Spread into a plain object so TS sees the index-signature shape
          // the metadata builder expects — the SDK's ProviderMeta is a
          // closed shape and won't widen to `{ [k]: unknown }` without help.
          this.emit(
            buildMetadataFrame(this.input.messageId, { ...chunk.providerMeta }),
          );
        } else if (chunk.type === 'token') {
          // Race guard #2: a chunk may have been buffered by the iterator
          // BEFORE cancel/disconnect aborted. Re-check after a microtask hop
          // so a cancel() that fired between the for-await yield and this
          // line cannot get an N+1 token emitted to the client OR appended
          // to partialContent (which would then desync from what the user
          // saw if cancelTurn raced ahead and persisted N).
          if (this.terminal !== null) return;
          this.partialContent += chunk.content;
          this.emit(buildTokenFrame(this.input.messageId, counter.next(), chunk.content));
        } else if (chunk.type === 'done') {
          providerMeta = chunk.providerMeta;
          // LLD Preamble §2: never re-emit metadata from done. The
          // providerMeta here exists for the inferences-row enrichment
          // path (workers projection consumer); we just stash it.
        }
      }
    } catch (err) {
      // SDK threw — could be pre-first-token or mid-stream. Either way,
      // flush partial + emit error + end.
      // LLD Task 45: this catch-block does NOT call the metadata emitter —
      // pre-token failures must NEVER produce a metadata frame
      // (Preamble §3). The orchestrator's only metadata emission lives in
      // the iterator's `chunk.type === 'commit'` branch above.
      if (this.terminal !== null) return; // disconnect already handled
      const code = errorCodeOf(err);
      this.terminal = 'failed';
      try {
        await this.chat.failTurn(this.input.messageId, this.partialContent, code);
      } catch (dbErr) {
        captureApiError({
          err: dbErr,
          feature: 'chat',
          layer: 'orchestrator',
          extra: { stage: 'failTurn-after-sdk-error', messageId: this.input.messageId },
        });
      }
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: { stage: 'sdk-stream', messageId: this.input.messageId, errorCode: code },
      });
      this.emit(buildErrorFrame(this.input.messageId, code, errorMessageOf(err)));
      this.emit(buildEndFrame(this.input.messageId, counter.next(), 'failed'));
      this.seqRegistry.release(this.input.messageId);
      return;
    }

    if (this.terminal !== null) return; // cancel/disconnect raced with last token
    this.terminal = 'complete';
    try {
      await this.chat.completeTurn(this.input.messageId, this.partialContent);
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: {
          stage: 'completeTurn',
          messageId: this.input.messageId,
          providerMeta: providerMeta ? JSON.stringify(providerMeta) : undefined,
        },
      });
    }
    // LLD Tasks 57/59 — meter wiring gated to the `complete` terminal only.
    // Meter throws are non-fatal: log + emit end without context fields.
    // Failed and canceled terminals NEVER invoke the meter (Task 59).
    const meterReadout = await this.computeMeter();
    this.emit(
      buildEndFrame(
        this.input.messageId,
        counter.next(),
        'complete',
        meterReadout ?? undefined,
      ),
    );
    this.seqRegistry.release(this.input.messageId);
  }

  private async computeMeter(): Promise<ContextMeterReadout | null> {
    if (!this.input.meter || !this.input.userId) return null;
    try {
      return await this.input.meter.compute({
        conversationId: this.input.conversationId,
        userId: this.input.userId,
        // Thread the turn's messageId so the meter's truncation event can be
        // correlated to this specific turn in log search.
        messageId: this.input.messageId,
      });
    } catch (err) {
      // chat-context-and-ux-polish (Codex review — meter-failure observability).
      // The meter failure is non-fatal (the `end` frame still ships, just
      // without context fields), but it must be QUERYABLE without going to
      // Sentry: emit a structured log AND stamp `llm.context_meter_failed=true`
      // on a span so it surfaces in Jaeger/log search. We capture to Sentry too
      // (it's still an error worth alerting on), but the log + span attr are
      // the operator's first-class signal.
      StreamOrchestrator.logger.warn(
        `llm.context_meter_failed=true conversationId=${this.input.conversationId} messageId=${this.input.messageId} reason=${errorMessageOf(err) ?? 'unknown'}`,
      );
      const tracer = trace.getTracer('@argus/api');
      const span = tracer.startSpan('chat.context_meter');
      span.setAttribute('llm.context_meter_failed', true);
      span.setAttribute('message.id', this.input.messageId);
      span.setAttribute('conversation.id', this.input.conversationId);
      span.end();
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: {
          stage: 'context-meter-compute',
          messageId: this.input.messageId,
        },
      });
      return null;
    }
  }

  /**
   * Cancel an in-flight stream. Idempotent — repeated calls after terminal
   * resolve to no-op.
   */
  async cancel(): Promise<void> {
    if (this.terminal !== null) return;
    this.terminal = 'canceled';
    this.input.abort.abort();
    try {
      await this.chat.cancelTurn(this.input.messageId, this.partialContent);
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: { stage: 'cancelTurn', messageId: this.input.messageId },
      });
    }
    const counter = this.seqRegistry.for(this.input.messageId);
    this.emit(buildCancelAckFrame(this.input.messageId));
    // LLD Task 59 — canceled terminal: no meter call, no context fields.
    this.emit(buildEndFrame(this.input.messageId, counter.next(), 'canceled'));
    this.seqRegistry.release(this.input.messageId);
  }

  /**
   * Client disconnected mid-stream. We must persist whatever we have and
   * stop the SDK iterator; we MUST NOT emit further frames (socket is
   * gone — any emit could throw on a half-closed socket).
   */
  async onDisconnect(): Promise<void> {
    if (this.terminal !== null) return;
    this.terminal = 'disconnected';
    this.input.abort.abort();
    try {
      await this.chat.failTurn(this.input.messageId, this.partialContent, 'client_disconnected');
    } catch (err) {
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: { stage: 'failTurn-disconnect', messageId: this.input.messageId },
      });
    }
    this.seqRegistry.release(this.input.messageId);
  }

  isTerminal(): boolean {
    return this.terminal !== null;
  }

  /** Read the committed providerMeta (when emitted). Test/debug surface. */
  getCommittedProviderMeta(): ProviderMeta | null {
    return this.committedProviderMeta;
  }

  private emit(frame: WsFrameOutbound): void {
    if (this.terminal === 'disconnected') return; // never emit after disconnect
    try {
      this.input.emit(frame);
    } catch (err) {
      // The socket may have closed between emits — capture but don't crash
      // the orchestrator. The next emit will hit the same guard.
      captureApiError({
        err,
        feature: 'chat',
        layer: 'orchestrator',
        extra: { stage: 'emit', messageId: this.input.messageId, frameType: frame.type },
      });
    }
  }
}

function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'sdk_error';
}

function errorMessageOf(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  return undefined;
}
