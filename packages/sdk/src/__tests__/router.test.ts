import { ProviderRouter } from '../router';
import { ProviderError } from '../index';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';
import type { ProviderAdapter, ProviderName } from '../providers/types';

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

/** Adapter that yields a single token then `done`. */
function stubHappy(name: ProviderName, model = `${name}-1`): ProviderAdapter {
  return {
    name,
    isConfigured: () => true,
    async *stream() {
      yield { type: 'token', content: `from-${name}` };
      yield {
        type: 'done',
        providerMeta: { provider: name, model, promptTokens: 1, completionTokens: 1 },
      };
    },
  };
}

/** Adapter that throws ProviderError BEFORE yielding anything. */
function stubPreTokenFail(name: ProviderName, code = 'auth_failed'): ProviderAdapter {
  return {
    name,
    isConfigured: () => true,
    // eslint-disable-next-line require-yield
    async *stream(): AsyncIterable<ChatStreamChunk> {
      throw new ProviderError(code, `${name} failed before first token`);
    },
  };
}

/** Adapter that reports not-configured. */
function stubUnconfigured(name: ProviderName): ProviderAdapter {
  return {
    name,
    isConfigured: () => false,
    async *stream() {
      throw new Error('should not be invoked');
    },
  };
}

async function collect(iter: AsyncIterable<ChatStreamChunk>): Promise<ChatStreamChunk[]> {
  const out: ChatStreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe('ProviderRouter', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('mockOnly=true short-circuits to the mock adapter', async () => {
    const router = new ProviderRouter({
      mockOnly: true,
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai'),
        anthropic: stubPreTokenFail('anthropic'),
        gemini: stubPreTokenFail('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-mock' });
    expect((chunks[1] as { type: string; providerMeta: { provider: string } }).providerMeta.provider).toBe('mock');
  });

  it('walks the priority order until a provider yields a token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubHappy('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-openai' });
  });

  it('skips unconfigured providers', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubUnconfigured('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-anthropic' });
  });

  it('fails over when a configured provider throws ProviderError before first token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai', 'auth_failed'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-anthropic' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('openai failed before first token'));
  });

  it('falls back to mock when all configured real providers fail pre-token', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubPreTokenFail('openai'),
        anthropic: stubPreTokenFail('anthropic'),
        gemini: stubPreTokenFail('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-mock' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('falling back to mock'));
  });

  it('throws no_providers_configured when MOCK_PROVIDER=false and zero keys are set', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic', 'gemini'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubUnconfigured('openai'),
        anthropic: stubUnconfigured('anthropic'),
        gemini: stubUnconfigured('gemini'),
      },
    });
    await expect(collect(router.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'no_providers_configured',
    });
  });

  it('respects custom order overriding the default openai-first preference', async () => {
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['gemini', 'anthropic', 'openai'],
      adapters: {
        mock: stubHappy('mock'),
        openai: stubHappy('openai'),
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-gemini' });
  });

  it('once committed to a provider, mid-stream errors propagate (no stitching)', async () => {
    const midStreamError: ProviderAdapter = {
      name: 'openai',
      isConfigured: () => true,
      async *stream() {
        yield { type: 'token', content: 'partial' };
        throw new Error('mid-stream boom');
      },
    };
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic'],
      adapters: {
        mock: stubHappy('mock'),
        openai: midStreamError,
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const iter = router.stream(makeReq())[Symbol.asyncIterator]();
    const first = await iter.next();
    expect(first.value).toEqual({ type: 'token', content: 'partial' });
    await expect(iter.next()).rejects.toThrow('mid-stream boom');
  });

  it('treats an empty stream as a pre-token failure and fails over', async () => {
    const emptyAdapter: ProviderAdapter = {
      name: 'openai',
      isConfigured: () => true,
      // eslint-disable-next-line require-yield
      async *stream() {
        return;
      },
    };
    const router = new ProviderRouter({
      mockOnly: false,
      order: ['openai', 'anthropic'],
      adapters: {
        mock: stubHappy('mock'),
        openai: emptyAdapter,
        anthropic: stubHappy('anthropic'),
        gemini: stubHappy('gemini'),
      },
    });
    const chunks = await collect(router.stream(makeReq()));
    expect(chunks[0]).toEqual({ type: 'token', content: 'from-anthropic' });
  });
});
