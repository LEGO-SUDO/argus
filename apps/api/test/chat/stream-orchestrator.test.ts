// StreamOrchestrator.
//
// chat-context-and-ux-polish backbone (LLD Tasks 40-47, 56-59):
//   - On the SDK `commit` chunk, emit the WS `metadata` frame (seq=1).
//     EXACTLY ONCE per turn even if the SDK defensively yields duplicates.
//   - Pre-token failure: no metadata frame ever leaks (Preamble §3).
//   - Meter wiring on the `complete` terminal: tolerates throws, omits
//     context fields on failure; never invoked on failed/canceled terminals.
import { StreamOrchestrator } from '../../src/chat/stream-orchestrator';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import type { ChatService } from '../../src/chat/chat.service';
import type { ContextMeterService } from '../../src/chat/context-meter.service';
import type { ChatStreamChunk } from '@argus/sdk';
import type { WsFrameOutbound } from '@argus/contracts';
import { randomUUID } from 'crypto';
import { trace, type Span, type Tracer } from '@opentelemetry/api';

const messageId = randomUUID();
const conversationId = randomUUID();

interface FakeChatRecord {
  completes: { messageId: string; content: string }[];
  cancels: { messageId: string; partial: string }[];
  fails: { messageId: string; partial: string; code: string }[];
}

function fakeChatService(): { svc: ChatService; rec: FakeChatRecord } {
  const rec: FakeChatRecord = { completes: [], cancels: [], fails: [] };
  const svc = {
    completeTurn: async (id: string, content: string) => {
      rec.completes.push({ messageId: id, content });
    },
    cancelTurn: async (id: string, partial: string) => {
      rec.cancels.push({ messageId: id, partial });
    },
    failTurn: async (id: string, partial: string, code: string) => {
      rec.fails.push({ messageId: id, partial, code });
    },
  } as unknown as ChatService;
  return { svc, rec };
}

function tokenStream(tokens: string[]): AsyncIterable<ChatStreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      // Backbone: the SDK now ships a synthetic `commit` chunk before the
      // first non-empty token (LLD Task 28). Mirror it here so the
      // orchestrator emits the `metadata` frame on the same trajectory the
      // real router takes.
      yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
      for (const t of tokens) {
        yield { type: 'token', content: t };
      }
      yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
    },
  };
}

/** Stream that yields tokens but pauses (via a promise) between them so the
 *  caller can race a cancel/disconnect against the next yield. */
function pausedStream(
  tokens: string[],
  pauses: Array<{ resolve: () => void; promise: Promise<void> }>,
  abortSignal: AbortSignal,
): AsyncIterable<ChatStreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      // Match the real router's synthetic commit chunk so the orchestrator
      // emits the metadata frame; tests that count frame indices below skip
      // past it.
      yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
      for (let i = 0; i < tokens.length; i++) {
        if (abortSignal.aborted) return;
        const tok = tokens[i]!;
        const gate = pauses[i];
        if (gate) await gate.promise;
        if (abortSignal.aborted) return;
        yield { type: 'token', content: tok };
      }
      yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
    },
  };
}

function makeGate(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

function emitter(): { emit: (f: WsFrameOutbound) => void; frames: WsFrameOutbound[] } {
  const frames: WsFrameOutbound[] = [];
  return { emit: (f) => frames.push(f), frames };
}

describe('StreamOrchestrator', () => {
  describe('happy path', () => {
    it('emits start@0 → metadata@1 → tokens@2..N → end with strictly increasing seq', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: tokenStream(['a', 'b', 'c']),
        abort,
        emit,
      });
      await o.runStream();

      const types = frames.map((f) => f.type);
      // Backbone: metadata@1 lives between start@0 and the token chain.
      expect(types).toEqual(['start', 'metadata', 'token', 'token', 'token', 'end']);
      const seqs = frames.map((f) => ('seq' in f ? f.seq : -1));
      expect(seqs).toEqual([0, 1, 2, 3, 4, 5]);
      const meta = frames.find((f) => f.type === 'metadata')!;
      expect(meta.type === 'metadata' && meta.providerMeta).toEqual({
        provider: 'mock',
        model: 'mock-1',
      });
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('complete');
      expect(rec.completes).toEqual([{ messageId, content: 'abc' }]);
      expect(seqRegistry.size()).toBe(0);
    });
  });

  describe('cancel path', () => {
    it('aborts iterator, calls cancelTurn with partial, emits cancel-ack + end(status=canceled), drops late tokens', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      const gates = [makeGate(), makeGate(), makeGate()];
      // Open the first two gates so two tokens flow immediately.
      gates[0]!.resolve();
      gates[1]!.resolve();
      const stream = pausedStream(['x', 'y', 'z'], gates, abort.signal);

      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: stream,
        abort,
        emit,
      });

      const runP = o.runStream();
      // Wait long enough for the first two token frames to be emitted.
      // (Each yield resolves a microtask; this loop runs them.)
      for (let i = 0; i < 5; i++) await Promise.resolve();
      // Give the for-await a chance to run.
      await new Promise((r) => setImmediate(r));

      await o.cancel();
      // Open the third gate AFTER cancel — the late token must be dropped.
      gates[2]!.resolve();
      await runP;

      const types = frames.map((f) => f.type);
      // start@0, metadata@1, two tokens, then cancel-ack + end. No third token.
      expect(types).toEqual(['start', 'metadata', 'token', 'token', 'cancel-ack', 'end']);
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('canceled');
      expect(rec.cancels).toEqual([{ messageId, partial: 'xy' }]);
      expect(abort.signal.aborted).toBe(true);
    });
  });

  describe('disconnect path', () => {
    it('aborts iterator, calls failTurn(partial, client_disconnected), emits no further frames', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      const gates = [makeGate(), makeGate()];
      gates[0]!.resolve();
      const stream = pausedStream(['x', 'y'], gates, abort.signal);

      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: stream,
        abort,
        emit,
      });
      const runP = o.runStream();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((r) => setImmediate(r));

      const frameCountBeforeDisconnect = frames.length;
      await o.onDisconnect();
      gates[1]!.resolve();
      await runP;

      expect(rec.fails).toEqual([{ messageId, partial: 'x', code: 'client_disconnected' }]);
      // No new frames emitted after disconnect.
      expect(frames.length).toBe(frameCountBeforeDisconnect);
      expect(abort.signal.aborted).toBe(true);
    });
  });

  describe('cancel race', () => {
    it('does NOT emit an N+1 token frame even if a chunk was buffered by a tightly-yielding stream', async () => {
      // Simulates the race where the SDK iterator yields a chunk and we enter
      // the for-await body, but cancel() has already flipped terminal between
      // the iterator's await and the body. The guard inside the token branch
      // MUST stop us from emitting that chunk or appending it to partialContent.
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      // A stream that yields tokens immediately (no gates) so the for-await
      // body runs back-to-back.
      const tightStream: AsyncIterable<ChatStreamChunk> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
          yield { type: 'token', content: 'a' };
          yield { type: 'token', content: 'b' };
          // Third token — by the time we reach here, the orchestrator may
          // have been cancelled. Yield anyway; the guard must reject it.
          yield { type: 'token', content: 'c' };
          yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
        },
      };

      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: tightStream,
        abort,
        emit,
      });

      // Race the orchestrator and cancel: cancel a microtask after run starts
      // so a couple of token frames flush, then cancel cuts in.
      const runP = o.runStream();
      // Let one token flush.
      await Promise.resolve();
      await Promise.resolve();
      await o.cancel();
      await runP;

      // Whatever tokens emitted MUST equal what was stored as partialContent.
      const tokenFrames = frames.filter((f) => f.type === 'token');
      const seenContent = tokenFrames.map((f) => (f.type === 'token' ? f.content : '')).join('');
      // cancelTurn was called with EXACTLY the content from emitted tokens —
      // no N+1 token leaked into either path.
      expect(rec.cancels).toHaveLength(1);
      expect(rec.cancels[0]!.partial).toBe(seenContent);
      // Final terminal frame is the end(canceled), nothing past it.
      const lastFrame = frames[frames.length - 1]!;
      expect(lastFrame.type).toBe('end');
      expect(lastFrame.type === 'end' && lastFrame.status).toBe('canceled');
    });
  });

  describe('SDK pre-first-token failure', () => {
    it('calls failTurn(empty, code), emits error + end(status=failed)', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      const errStream: AsyncIterable<ChatStreamChunk> = {
        async *[Symbol.asyncIterator]() {
          const e = new Error('provider went away') as Error & { code: string };
          e.code = 'provider_unavailable';
          throw e;
        },
      };
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: errStream,
        abort,
        emit,
      });
      await o.runStream();

      const types = frames.map((f) => f.type);
      expect(types).toEqual(['start', 'error', 'end']);
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('failed');
      const err = frames.find((f) => f.type === 'error')!;
      expect(err.type === 'error' && err.errorCode).toBe('provider_unavailable');
      expect(rec.fails).toEqual([
        { messageId, partial: '', code: 'provider_unavailable' },
      ]);
    });
  });

  // chat-context-and-ux-polish LLD Tasks 42/44 — metadata-frame guards.
  describe('metadata frame exactly-once + pre-token guard', () => {
    it('emits exactly one metadata frame even on duplicate commit chunks', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      const dupCommit: AsyncIterable<ChatStreamChunk> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
          // Defensive duplicate — orchestrator MUST coalesce.
          yield { type: 'commit', providerMeta: { provider: 'mock', model: 'mock-1' } };
          yield { type: 'token', content: 'a' };
          yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
        },
      };

      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: dupCommit,
        abort,
        emit,
      });
      await o.runStream();
      const metadataFrames = frames.filter((f) => f.type === 'metadata');
      expect(metadataFrames).toHaveLength(1);
    });

    // chat-context-and-ux-polish (Codex review — runtime invariant: metadata
    // exactly once per completed turn). A malformed/injected SDK stream that
    // emits `done` with NO commit and NO token must still get a defensive
    // metadata frame so a completed turn always carries metadata exactly once.
    it('emits a defensive metadata frame from done when the stream never committed and emitted no token', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const warn = jest
        .spyOn(
          (StreamOrchestrator as unknown as { logger: { warn: (m: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      try {
        const commitlessDone: AsyncIterable<ChatStreamChunk> = {
          async *[Symbol.asyncIterator]() {
            // No commit, no token — just a terminal done.
            yield { type: 'done', providerMeta: { provider: 'mock', model: 'mock-1' } };
          },
        };
        const o = new StreamOrchestrator(svc, seqRegistry, {
          messageId,
          conversationId,
          sdkStream: commitlessDone,
          abort,
          emit,
        });
        await o.runStream();
        const types = frames.map((f) => f.type);
        expect(types).toEqual(['start', 'metadata', 'end']);
        const seqs = frames.map((f) => ('seq' in f ? f.seq : -1));
        expect(seqs).toEqual([0, 1, 2]);
        const meta = frames.find((f) => f.type === 'metadata')!;
        expect(meta.type === 'metadata' && meta.providerMeta).toEqual({
          provider: 'mock',
          model: 'mock-1',
        });
        expect(warn.mock.calls[0]![0] as string).toContain('metadata.missing_commit');
      } finally {
        warn.mockRestore();
      }
    });

    it('pre-token error: NO metadata frame leaks between start and the terminal failure end', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();

      const errStream: AsyncIterable<ChatStreamChunk> = {
        async *[Symbol.asyncIterator]() {
          const e = new Error('pinned provider missing') as Error & { code: string };
          e.code = 'pinned_provider_unavailable';
          throw e;
        },
      };
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        sdkStream: errStream,
        abort,
        emit,
      });
      await o.runStream();

      const types = frames.map((f) => f.type);
      expect(types).toEqual(['start', 'error', 'end']);
      // No metadata frame leaked.
      expect(frames.some((f) => f.type === 'metadata')).toBe(false);
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('failed');
      expect(rec.fails[0]!.code).toBe('pinned_provider_unavailable');
    });
  });

  // chat-context-and-ux-polish LLD Tasks 56-59 — meter wiring on the
  // `complete` terminal path. Tolerates throws (omit fields); never invoked
  // on failed/canceled terminals.
  describe('context meter on the complete terminal', () => {
    function meterStub(
      result: { tokensUsed: number; tokensBudget: number } | Error,
    ): {
      svc: ContextMeterService;
      calls: { conversationId: string; userId: string; messageId?: string }[];
    } {
      const calls: { conversationId: string; userId: string; messageId?: string }[] = [];
      const svc = {
        compute: async (input: { conversationId: string; userId: string; messageId?: string }) => {
          calls.push(input);
          if (result instanceof Error) throw result;
          return result;
        },
      } as unknown as ContextMeterService;
      return { svc, calls };
    }

    it('threads tokensUsed + tokensBudget onto the end frame on the happy complete path', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const meter = meterStub({ tokensUsed: 250, tokensBudget: 10000 });
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const userId = randomUUID();
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        userId,
        meter: meter.svc,
        sdkStream: tokenStream(['a', 'b']),
        abort,
        emit,
      });
      await o.runStream();
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.tokensUsed).toBe(250);
      expect(end.type === 'end' && end.tokensBudget).toBe(10000);
      // The orchestrator threads the turn's messageId so the meter's
      // truncation event can correlate to this turn.
      expect(meter.calls).toEqual([{ conversationId, userId, messageId }]);
    });

    it('meter throwing does NOT prevent the terminal end frame — both fields absent', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const meter = meterStub(new Error('meter blew up'));
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        userId: randomUUID(),
        meter: meter.svc,
        sdkStream: tokenStream(['a']),
        abort,
        emit,
      });
      await o.runStream();
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('complete');
      expect(end.type === 'end' && end.tokensUsed).toBeUndefined();
      expect(end.type === 'end' && end.tokensBudget).toBeUndefined();
    });

    // chat-context-and-ux-polish (Codex review — meter-failure observability).
    // A meter throw must be queryable without Sentry: a structured log AND a
    // span carrying llm.context_meter_failed=true.
    it('on a meter throw, emits a structured log and a span with llm.context_meter_failed=true', async () => {
      // Capture the span's attributes by spying on the tracer.
      const setAttribute = jest.fn();
      const fakeSpan = { setAttribute, end: jest.fn() } as unknown as Span;
      const startSpan = jest.fn().mockReturnValue(fakeSpan);
      const getTracer = jest
        .spyOn(trace, 'getTracer')
        .mockReturnValue({ startSpan } as unknown as Tracer);
      const warn = jest
        .spyOn(
          (StreamOrchestrator as unknown as { logger: { warn: (m: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      try {
        const seqRegistry = new SeqCounterRegistry();
        const { svc } = fakeChatService();
        const meter = meterStub(new Error('meter blew up'));
        const { emit, frames } = emitter();
        const abort = new AbortController();
        const o = new StreamOrchestrator(svc, seqRegistry, {
          messageId,
          conversationId,
          userId: randomUUID(),
          meter: meter.svc,
          sdkStream: tokenStream(['a']),
          abort,
          emit,
        });
        await o.runStream();

        // Structured log fired with the queryable attribute keyword.
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0] as string).toContain('llm.context_meter_failed=true');
        expect(warn.mock.calls[0]![0] as string).toContain(`messageId=${messageId}`);

        // Span carries the attribute.
        expect(startSpan).toHaveBeenCalledWith('chat.context_meter');
        expect(setAttribute).toHaveBeenCalledWith('llm.context_meter_failed', true);
        expect(setAttribute).toHaveBeenCalledWith('message.id', messageId);

        // The end frame still ships (non-fatal) without context fields.
        const end = frames.find((f) => f.type === 'end')!;
        expect(end.type === 'end' && end.status).toBe('complete');
        expect(end.type === 'end' && end.tokensUsed).toBeUndefined();
      } finally {
        warn.mockRestore();
        getTracer.mockRestore();
      }
    });

    it('meter never invoked on the failed terminal; end carries neither token field', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const meter = meterStub({ tokensUsed: 999, tokensBudget: 10000 });
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const errStream: AsyncIterable<ChatStreamChunk> = {
        async *[Symbol.asyncIterator]() {
          const e = new Error('boom') as Error & { code: string };
          e.code = 'sdk_error';
          throw e;
        },
      };
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        userId: randomUUID(),
        meter: meter.svc,
        sdkStream: errStream,
        abort,
        emit,
      });
      await o.runStream();
      expect(meter.calls).toHaveLength(0);
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('failed');
      expect(end.type === 'end' && end.tokensUsed).toBeUndefined();
      expect(end.type === 'end' && end.tokensBudget).toBeUndefined();
    });

    it('meter never invoked on the canceled terminal; end carries neither token field', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc } = fakeChatService();
      const meter = meterStub({ tokensUsed: 999, tokensBudget: 10000 });
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const gates = [makeGate(), makeGate()];
      gates[0]!.resolve();
      const stream = pausedStream(['a', 'b'], gates, abort.signal);

      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        userId: randomUUID(),
        meter: meter.svc,
        sdkStream: stream,
        abort,
        emit,
      });
      const runP = o.runStream();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      await o.cancel();
      gates[1]!.resolve();
      await runP;

      expect(meter.calls).toHaveLength(0);
      const end = frames.find((f) => f.type === 'end')!;
      expect(end.type === 'end' && end.status).toBe('canceled');
      expect(end.type === 'end' && end.tokensUsed).toBeUndefined();
      expect(end.type === 'end' && end.tokensBudget).toBeUndefined();
    });
  });
});
