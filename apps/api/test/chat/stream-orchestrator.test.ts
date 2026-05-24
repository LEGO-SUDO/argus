// Tasks 47-54 — StreamOrchestrator.
import { StreamOrchestrator } from '../../src/chat/stream-orchestrator';
import { SeqCounterRegistry } from '../../src/chat/seq-counter';
import type { ChatService } from '../../src/chat/chat.service';
import type { ChatStreamChunk } from '@argus/sdk';
import type { WsFrameOutbound } from '@argus/contracts';
import { randomUUID } from 'crypto';

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
    it('emits start → tokens → end in order with strictly increasing seq', async () => {
      const seqRegistry = new SeqCounterRegistry();
      const { svc, rec } = fakeChatService();
      const { emit, frames } = emitter();
      const abort = new AbortController();
      const o = new StreamOrchestrator(svc, seqRegistry, {
        messageId,
        conversationId,
        provider: 'mock',
        model: 'mock-1',
        sdkStream: tokenStream(['a', 'b', 'c']),
        abort,
        emit,
      });
      await o.runStream();

      const types = frames.map((f) => f.type);
      expect(types).toEqual(['start', 'token', 'token', 'token', 'end']);
      const seqs = frames.map((f) => ('seq' in f ? f.seq : -1));
      expect(seqs).toEqual([0, 1, 2, 3, 4]);
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
        provider: 'mock',
        model: 'mock-1',
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
      // Two tokens, then cancel-ack + end. No third token frame.
      expect(types).toEqual(['start', 'token', 'token', 'cancel-ack', 'end']);
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
        provider: 'mock',
        model: 'mock-1',
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
        provider: 'mock',
        model: 'mock-1',
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
        provider: 'mock',
        model: 'mock-1',
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
});
