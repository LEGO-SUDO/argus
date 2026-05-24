// StreamOrchestrator — the only call site for packages/sdk's chat.stream.
//
// Lifecycle:
//   runStream({ messageId, sdkStream, emit, conversationId, provider, model })
//     1. emit(start)
//     2. for each token in sdkStream — emit(token), accumulate content
//     3. on done — completeTurn(content), emit(end status='complete'), release
//     4. on cancel() — abort sdk iterator, cancelTurn(partial),
//                       emit(cancel-ack), emit(end status='canceled'), release
//     5. on onDisconnect() — abort, failTurn(partial, 'client_disconnected'),
//                             do NOT emit further (socket is gone)
//     6. on SDK throw — failTurn(partial, code), emit(error), emit(end status='failed')
//
// Tasks 47..54. The orchestrator owns a single AbortController per
// invocation; sdkStream.signal is the same controller's signal.
import type { ChatStreamChunk, ProviderMeta } from '@argus/sdk';
import { ChatService } from './chat.service';
import { SeqCounterRegistry } from './seq-counter';
import {
  buildCancelAckFrame,
  buildEndFrame,
  buildErrorFrame,
  buildStartFrame,
  buildTokenFrame,
} from './frame-builder';
import type { WsFrameOutbound } from '@argus/contracts';
import { captureApiError } from '../observability/sentry';

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
}

type Terminal = 'complete' | 'canceled' | 'failed' | 'disconnected';

export class StreamOrchestrator {
  private terminal: Terminal | null = null;
  private partialContent = '';

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
        if (chunk.type === 'token') {
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
        }
      }
    } catch (err) {
      // SDK threw — could be pre-first-token or mid-stream. Either way,
      // flush partial + emit error + end.
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
    this.emit(buildEndFrame(this.input.messageId, counter.next(), 'complete'));
    this.seqRegistry.release(this.input.messageId);
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
