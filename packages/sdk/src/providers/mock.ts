// Mock provider — deterministic streaming for keyless dev + replay tests.
//
// Per HLD D3: the same (conversationId, turnIndex) MUST produce the same
// token sequence byte-for-byte, otherwise Phase B replay-against-mock loses
// its meaning. We achieve this with a tiny seeded PRNG (mulberry32) over a
// hash of (conversationId, turnIndex, MOCK_RESPONSE).
//
// MOCK_RESPONSE override: if set, the response is the literal string. If
// unset, we generate a 12-32 token deterministic response from a small
// vocabulary so the UI shows realistic streaming during dev. Either way,
// token boundaries are stable across runs for the same seed.

import type { ProviderAdapter } from './types';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';

const VOCAB = [
  'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'a', 'lazy', 'dog',
  'streaming', 'response', 'from', 'mock', 'provider', 'with', 'deterministic',
  'token', 'sequence', 'and', 'stable', 'seed', 'for', 'replay', 'tests',
  'so', 'every', 'request', 'gets', 'identical', 'output', 'each', 'time',
];

export class MockProvider implements ProviderAdapter {
  readonly name = 'mock' as const;

  isConfigured(): boolean {
    return true;
  }

  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const override = process.env.MOCK_RESPONSE;
    const text = override !== undefined && override.length > 0
      ? override
      : generateResponse(req.conversationId, req.turnIndex);
    const tokens = tokenize(text);

    for (const tok of tokens) {
      if (req.signal?.aborted) return;
      // Microtask hop lets the caller interleave abort/cancel between yields.
      await Promise.resolve();
      yield { type: 'token', content: tok };
    }

    const promptTokens = approxTokens(req.messages.map((m) => m.content).join(' '));
    const completionTokens = approxTokens(text);
    yield {
      type: 'done',
      providerMeta: {
        provider: 'mock',
        model: process.env.MOCK_MODEL ?? 'mock-1',
        promptTokens,
        completionTokens,
      },
    };
  }
}

/** Default singleton. The router holds this so MOCK_RESPONSE changes per call. */
export const mockProvider = new MockProvider();

// ---- internals -------------------------------------------------------------

/** Tokenize into whitespace-bearing chunks (keeps spaces on the token). */
export function tokenize(text: string): string[] {
  const matches = text.match(/\S+\s*/g);
  return matches ?? [text];
}

/**
 * Generate a deterministic response of 12-32 tokens drawn from VOCAB, seeded
 * by (conversationId, turnIndex). Same seed → identical string.
 */
export function generateResponse(conversationId: string, turnIndex: number): string {
  const seed = hashSeed(`${conversationId}:${turnIndex}`);
  const rand = mulberry32(seed);
  const len = 12 + Math.floor(rand() * 21); // 12..32 inclusive
  const words: string[] = [];
  for (let i = 0; i < len; i++) {
    const idx = Math.floor(rand() * VOCAB.length);
    const w = VOCAB[idx] ?? 'mock';
    words.push(w);
  }
  // Capitalize first, period at end — same shape each time for the same seed.
  const first = words[0] ?? 'mock';
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ') + '.';
}

/** Tiny xmur3-style string hash → 32-bit integer seed. */
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

/** mulberry32 PRNG — deterministic, fast, good enough for fixture generation. */
function mulberry32(a: number): () => number {
  let state = a >>> 0;
  return function (): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap token estimate: ~4 chars per token. Matches OpenAI's rule-of-thumb. */
function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}
