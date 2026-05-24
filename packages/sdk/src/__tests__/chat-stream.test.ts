// End-to-end: exercises chat.stream → router → mock provider with the
// real index module. Confirms the public surface preserves the same shape
// apps/api compiles against.

import { chat } from '../index';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';

function makeReq(overrides: Partial<ChatStreamRequest> = {}): ChatStreamRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    conversationId: 'c1',
    turnIndex: 0,
    userId: 'u1',
    messageId: 'm1',
    ...overrides,
  };
}

async function collect(iter: AsyncIterable<ChatStreamChunk>): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('chat.stream (integration via index → router → mock)', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('default MOCK_PROVIDER unset → uses mock and yields tokens + done', async () => {
    delete process.env.MOCK_PROVIDER;
    process.env.MOCK_RESPONSE = 'one two three';
    const chunks = await collect(chat.stream(makeReq()));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{ type: 'token'; content: string }>;
    const done = chunks.find((c) => c.type === 'done') as { type: 'done'; providerMeta: { provider: string } } | undefined;
    expect(tokens.map((t) => t.content).join('')).toEqual('one two three');
    expect(done?.providerMeta.provider).toEqual('mock');
  });

  it('aborting mid-stream stops the iterator and does not throw', async () => {
    delete process.env.MOCK_PROVIDER;
    delete process.env.MOCK_RESPONSE;
    const ac = new AbortController();
    const iter = chat.stream(makeReq({ signal: ac.signal }))[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.done).toBe(false);
    ac.abort();
    // Subsequent pulls drain cleanly to done without throwing.
    let next = await iter.next();
    while (!next.done) {
      next = await iter.next();
    }
    expect(next.done).toBe(true);
  });

  it('MOCK_PROVIDER=false with no keys throws ProviderError(no_providers_configured)', async () => {
    process.env.MOCK_PROVIDER = 'false';
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    await expect(collect(chat.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'no_providers_configured',
    });
  });
});
