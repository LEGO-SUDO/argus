import { AnthropicProvider, mapAnthropicError, splitSystem } from '../providers/anthropic';
import { AuthenticationError, RateLimitError, APIConnectionError, APIUserAbortError } from '@anthropic-ai/sdk';
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

describe('AnthropicProvider', () => {
  it('isConfigured reflects apiKey option', () => {
    expect(new AnthropicProvider({ apiKey: 'k' }).isConfigured()).toBe(true);
    expect(new AnthropicProvider({ apiKey: '' }).isConfigured()).toBe(false);
  });

  it('happy path yields tokens + done with usage from start/delta events', async () => {
    const stream = asyncIterableOf([
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
      { type: 'content_block_stop' },
      { type: 'message_delta', usage: { output_tokens: 4 } },
      { type: 'message_stop' },
    ]);
    const client = {
      messages: { create: jest.fn().mockResolvedValue(stream) },
    };
    const provider = new AnthropicProvider({
      apiKey: 'k',
      model: 'claude-3-5-haiku-latest',
      client: client as never,
    });

    const chunks = await collect(provider.stream(makeReq()));
    expect(chunks).toEqual([
      { type: 'token', content: 'Hello' },
      { type: 'token', content: ' world' },
      {
        type: 'done',
        providerMeta: {
          provider: 'anthropic',
          model: 'claude-3-5-haiku-latest',
          promptTokens: 7,
          completionTokens: 4,
        },
      },
    ]);
  });

  it('lifts system messages out into the top-level system field', async () => {
    const create = jest.fn().mockResolvedValue(asyncIterableOf([{ type: 'message_stop' }]));
    const provider = new AnthropicProvider({
      apiKey: 'k',
      client: { messages: { create } } as never,
    });
    await collect(provider.stream(makeReq()));
    const args = create.mock.calls[0][0] as { system?: string; messages: { role: string }[] };
    expect(args.system).toBe('be brief');
    expect(args.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('uses req.pin.model in the outbound create() call, overriding env/default (Codex review #1)', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(asyncIterableOf([{ type: 'message_stop' }]));
    // No model opt and no env — would default to claude-haiku-4-5 without the pin.
    const provider = new AnthropicProvider({
      apiKey: 'k',
      client: { messages: { create } } as never,
    });
    const chunks = await collect(
      provider.stream(makeReq({ pin: { provider: 'anthropic', model: 'claude-opus-4-7' } })),
    );
    expect(create.mock.calls[0]![0].model).toBe('claude-opus-4-7');
    const done = chunks.find((c) => c.type === 'done');
    expect(done && done.type === 'done' && done.providerMeta.model).toBe('claude-opus-4-7');
  });

  it('maps an AuthenticationError to ProviderError(auth_failed)', async () => {
    const client = {
      messages: {
        create: jest.fn().mockRejectedValue(new AuthenticationError(401, undefined, 'bad', undefined)),
      },
    };
    const provider = new AnthropicProvider({ apiKey: 'k', client: client as never });
    await expect(collect(provider.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'auth_failed',
    });
  });

  it('honors a pre-flight aborted signal cleanly', async () => {
    const ac = new AbortController();
    ac.abort();
    const client = {
      messages: {
        create: jest.fn().mockRejectedValue(new APIUserAbortError({ message: 'aborted' })),
      },
    };
    const provider = new AnthropicProvider({ apiKey: 'k', client: client as never });
    const chunks = await collect(provider.stream(makeReq({ signal: ac.signal })));
    expect(chunks).toEqual([]);
  });

  it('stops mid-stream when signal aborts', async () => {
    const ac = new AbortController();
    const stream = {
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        let i = 0;
        return {
          async next(): Promise<IteratorResult<unknown>> {
            i++;
            if (i === 1) {
              return {
                value: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'one' } },
                done: false,
              };
            }
            if (i === 2) {
              ac.abort();
              return {
                value: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'two' } },
                done: false,
              };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
    const client = { messages: { create: jest.fn().mockResolvedValue(stream) } };
    const provider = new AnthropicProvider({ apiKey: 'k', client: client as never });
    const chunks = await collect(provider.stream(makeReq({ signal: ac.signal })));
    expect(chunks.find((c) => c.type === 'token' && c.content === 'one')).toBeTruthy();
    expect(chunks.find((c) => c.type === 'done')).toBeUndefined();
  });
});

describe('splitSystem', () => {
  it('concatenates multiple system messages with blank-line separators', () => {
    const out = splitSystem([
      { role: 'system', content: 'one' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'two' },
    ]);
    expect(out.system).toBe('one\n\ntwo');
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('returns system=undefined when there are no system messages', () => {
    const out = splitSystem([{ role: 'user', content: 'hi' }]);
    expect(out.system).toBeUndefined();
  });
});

describe('mapAnthropicError', () => {
  it('maps known SDK errors', () => {
    expect(mapAnthropicError(new AuthenticationError(401, undefined, 'x', undefined)).code).toBe('auth_failed');
    expect(mapAnthropicError(new RateLimitError(429, undefined, 'x', undefined)).code).toBe('rate_limited');
    expect(mapAnthropicError(new APIConnectionError({ message: 'down' })).code).toBe('network_error');
    expect(mapAnthropicError(new Error('???'))).toBeInstanceOf(ProviderError);
  });
});
