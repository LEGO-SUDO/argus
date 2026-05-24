import { MockProvider, generateResponse, tokenize } from '../providers/mock';
import type { ChatStreamRequest } from '../index';

function makeReq(overrides: Partial<ChatStreamRequest> = {}): ChatStreamRequest {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    conversationId: 'c1',
    turnIndex: 0,
    userId: 'u1',
    messageId: 'm1',
    ...overrides,
  };
}

async function collect(iter: AsyncIterable<{ type: 'token' | 'done'; content?: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of iter) {
    if (c.type === 'token' && typeof c.content === 'string') out.push(c.content);
  }
  return out;
}

describe('MockProvider determinism', () => {
  beforeEach(() => {
    delete process.env.MOCK_RESPONSE;
  });

  it('isConfigured is always true', () => {
    expect(new MockProvider().isConfigured()).toBe(true);
  });

  it('same (conversationId, turnIndex) → byte-identical token stream', async () => {
    const provider = new MockProvider();
    const req = makeReq({ conversationId: 'conv-A', turnIndex: 3 });
    const a = await collect(provider.stream(req));
    const b = await collect(provider.stream(req));
    expect(a).toEqual(b);
    expect(a.join('')).toEqual(b.join(''));
  });

  it('different turnIndex → different stream', async () => {
    const provider = new MockProvider();
    const a = await collect(provider.stream(makeReq({ conversationId: 'conv-X', turnIndex: 0 })));
    const b = await collect(provider.stream(makeReq({ conversationId: 'conv-X', turnIndex: 1 })));
    expect(a.join('')).not.toEqual(b.join(''));
  });

  it('different conversationId → different stream', async () => {
    const provider = new MockProvider();
    const a = await collect(provider.stream(makeReq({ conversationId: 'conv-A', turnIndex: 0 })));
    const b = await collect(provider.stream(makeReq({ conversationId: 'conv-B', turnIndex: 0 })));
    expect(a.join('')).not.toEqual(b.join(''));
  });

  it('MOCK_RESPONSE env overrides the generated response and remains deterministic', async () => {
    process.env.MOCK_RESPONSE = 'one two three';
    const provider = new MockProvider();
    const a = await collect(provider.stream(makeReq()));
    expect(a.join('')).toEqual('one two three');
  });

  it('emits a done chunk with mock providerMeta and token counts', async () => {
    const provider = new MockProvider();
    const chunks: unknown[] = [];
    for await (const c of provider.stream(makeReq())) chunks.push(c);
    const done = chunks[chunks.length - 1] as { type: string; providerMeta: { provider: string; promptTokens: number; completionTokens: number } };
    expect(done.type).toBe('done');
    expect(done.providerMeta.provider).toBe('mock');
    expect(done.providerMeta.promptTokens).toBeGreaterThan(0);
    expect(done.providerMeta.completionTokens).toBeGreaterThan(0);
  });

  it('honors signal abort between tokens', async () => {
    const ac = new AbortController();
    const provider = new MockProvider();
    const iter = provider.stream(makeReq({ signal: ac.signal }))[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);
    ac.abort();
    // After abort, the iterator returns done=true on the next pull.
    const next = await iter.next();
    expect(next.done).toBe(true);
  });
});

describe('mock helpers', () => {
  it('tokenize keeps whitespace on the token (so concat reproduces original)', () => {
    const t = tokenize('hello world!');
    expect(t.join('')).toEqual('hello world!');
  });

  it('generateResponse is pure for identical seeds', () => {
    const a = generateResponse('conv-Z', 7);
    const b = generateResponse('conv-Z', 7);
    expect(a).toEqual(b);
    // 12..32 words + 1 period at end → at least 12 spaces.
    expect(a.split(' ').length).toBeGreaterThanOrEqual(12);
    expect(a.split(' ').length).toBeLessThanOrEqual(32);
  });
});
