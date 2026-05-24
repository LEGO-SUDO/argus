import { OpenAIProvider, mapOpenAIError } from '../providers/openai';
import { AuthenticationError, RateLimitError, APIConnectionError, APIUserAbortError } from 'openai';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

function makeReq(overrides: Partial<ChatStreamRequest> = {}): ChatStreamRequest {
  return {
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ],
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

/** Construct a fake openai-shaped streaming chunk. */
function chunkOf(content: string | undefined, usage?: { prompt_tokens: number; completion_tokens: number }): unknown {
  return {
    choices: [{ delta: content !== undefined ? { content } : {} }],
    ...(usage ? { usage } : {}),
  };
}

/** Adapter-side helper: produce an async iterable that yields the given list. */
function asyncIterableOf(items: unknown[]): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next(): Promise<IteratorResult<unknown>> {
          if (i >= items.length) return { value: undefined, done: true };
          const v = items[i++];
          await Promise.resolve();
          return { value: v, done: false };
        },
      };
    },
  };
}

describe('OpenAIProvider', () => {
  it('isConfigured reflects the apiKey option / env', () => {
    expect(new OpenAIProvider({ apiKey: 'sk-123' }).isConfigured()).toBe(true);
    expect(new OpenAIProvider({ apiKey: '' }).isConfigured()).toBe(false);
  });

  it('happy path yields tokens then done with usage', async () => {
    const stream = asyncIterableOf([
      chunkOf('Hel'),
      chunkOf('lo'),
      chunkOf('!', { prompt_tokens: 10, completion_tokens: 3 }),
    ]);
    const client = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue(stream),
        },
      },
    } as unknown as Parameters<typeof OpenAIProvider.prototype.stream>[0] extends never ? never : Parameters<ConstructorParameters<typeof OpenAIProvider>[0] extends infer T ? T : never>;
    const provider = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o-mini', client: client as never });

    const chunks = await collect(provider.stream(makeReq()));
    expect(chunks.length).toBe(4);
    expect(chunks[0]).toEqual({ type: 'token', content: 'Hel' });
    expect(chunks[1]).toEqual({ type: 'token', content: 'lo' });
    expect(chunks[2]).toEqual({ type: 'token', content: '!' });
    expect(chunks[3]).toEqual({
      type: 'done',
      providerMeta: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 10,
        completionTokens: 3,
      },
    });
  });

  it('uses req.pin.model in the outbound create() call, overriding env/default (Codex review #1)', async () => {
    const stream = asyncIterableOf([chunkOf('hi', { prompt_tokens: 1, completion_tokens: 1 })]);
    const create = jest.fn().mockResolvedValue(stream);
    const client = { chat: { completions: { create } } };
    // No model opt and no env — would default to gpt-4o-mini without the pin.
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: client as never });
    const chunks = await collect(
      provider.stream(makeReq({ pin: { provider: 'openai', model: 'gpt-4o' } })),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].model).toBe('gpt-4o');
    // The done frame reports the pinned model too.
    const done = chunks.find((c) => c.type === 'done');
    expect(done && done.type === 'done' && done.providerMeta.model).toBe('gpt-4o');
  });

  it('maps an AuthenticationError to ProviderError(auth_failed) before first token', async () => {
    const authErr = new AuthenticationError(401, undefined, 'bad key', undefined);
    const client = {
      chat: { completions: { create: jest.fn().mockRejectedValue(authErr) } },
    };
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: client as never });
    await expect(collect(provider.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'auth_failed',
    });
  });

  it('honors a pre-flight aborted signal cleanly (no throw)', async () => {
    const ac = new AbortController();
    ac.abort();
    const client = {
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(new APIUserAbortError({ message: 'aborted' })),
        },
      },
    };
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: client as never });
    const chunks = await collect(provider.stream(makeReq({ signal: ac.signal })));
    expect(chunks).toEqual([]);
  });

  it('stops iterating when signal aborts mid-stream (no throw)', async () => {
    const ac = new AbortController();
    const stream = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        let i = 0;
        return {
          async next(): Promise<IteratorResult<unknown>> {
            i++;
            if (i === 1) return { value: chunkOf('one'), done: false };
            if (i === 2) {
              ac.abort();
              return { value: chunkOf('two'), done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
    const client = {
      chat: { completions: { create: jest.fn().mockResolvedValue(stream) } },
    };
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: client as never });
    const chunks = await collect(provider.stream(makeReq({ signal: ac.signal })));
    // We see the first token, then abort kicks in before the next iteration emits.
    expect(chunks.find((c) => c.type === 'token' && c.content === 'one')).toBeTruthy();
    expect(chunks.find((c) => c.type === 'done')).toBeUndefined();
  });
});

describe('mapOpenAIError', () => {
  it('maps known SDK errors', () => {
    expect(mapOpenAIError(new AuthenticationError(401, undefined, 'x', undefined)).code).toBe('auth_failed');
    expect(mapOpenAIError(new RateLimitError(429, undefined, 'x', undefined)).code).toBe('rate_limited');
    expect(mapOpenAIError(new APIConnectionError({ message: 'down' })).code).toBe('network_error');
  });
  it('maps unknown errors to provider_error', () => {
    expect(mapOpenAIError(new Error('???')).code).toBe('provider_error');
    expect(mapOpenAIError('string').code).toBe('provider_error');
  });
  it('returns ProviderError instances', () => {
    expect(mapOpenAIError(new Error('x'))).toBeInstanceOf(ProviderError);
  });
});
