// Tests for the Gemini adapter (Interactions API, fetch-based).
//
// We stub `fetch` to return a synthesized SSE body that mirrors the real
// API event sequence (interaction.created → step.start (thought) →
// step.delta thought_signature → step.stop → step.start (model_output) →
// step.delta text → step.stop → interaction.completed → done).

import { GeminiAdapter } from '../providers/gemini';
import type { ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

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
  for await (const ch of iter) out.push(ch);
  return out;
}

function sseResponse(body: string, init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, init ?? { status: 200 });
}

function happyPathSse(text: string, inputTokens = 8, outputTokens = 7): string {
  // Each event block separated by \n\n per SSE spec.
  return [
    `event: interaction.created\ndata: ${JSON.stringify({
      interaction: { id: 'v1_abc', status: 'in_progress', model: 'gemini-3-flash-preview' },
      event_type: 'interaction.created',
    })}`,
    `event: step.start\ndata: ${JSON.stringify({
      index: 0,
      step: { type: 'thought' },
      event_type: 'step.start',
    })}`,
    `event: step.delta\ndata: ${JSON.stringify({
      index: 0,
      delta: { signature: 'opaque', type: 'thought_signature' },
      event_type: 'step.delta',
    })}`,
    `event: step.stop\ndata: ${JSON.stringify({ index: 0, event_type: 'step.stop' })}`,
    `event: step.start\ndata: ${JSON.stringify({
      index: 1,
      step: { type: 'model_output' },
      event_type: 'step.start',
    })}`,
    `event: step.delta\ndata: ${JSON.stringify({
      index: 1,
      delta: { text, type: 'text' },
      event_type: 'step.delta',
    })}`,
    `event: step.stop\ndata: ${JSON.stringify({ index: 1, event_type: 'step.stop' })}`,
    `event: interaction.completed\ndata: ${JSON.stringify({
      interaction: {
        id: 'v1_abc',
        status: 'completed',
        usage: {
          total_input_tokens: inputTokens,
          total_output_tokens: outputTokens,
        },
        model: 'gemini-3-flash-preview',
      },
      event_type: 'interaction.completed',
    })}`,
    `event: done\ndata: [DONE]`,
    '', // trailing newline so the final block is parsed
  ].join('\n\n');
}

describe('GeminiAdapter (Interactions API)', () => {
  it('isConfigured reflects the API key', () => {
    expect(new GeminiAdapter({ apiKey: 'k' }).isConfigured()).toBe(true);
    expect(new GeminiAdapter({ apiKey: '' }).isConfigured()).toBe(false);
  });

  it('streams text deltas from model_output steps, skipping thought signatures', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse('Hello, how are you today?')));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    const chunks = await collect(adapter.stream(makeReq()));

    const tokens = chunks.filter((c) => c.type === 'token').map((c) => (c as { type: 'token'; content: string }).content);
    expect(tokens).toEqual(['Hello, how are you today?']);

    const done = chunks.find((c) => c.type === 'done') as
      | { type: 'done'; providerMeta: { provider: string; model: string; promptTokens?: number; completionTokens?: number } }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.providerMeta.provider).toBe('gemini');
    expect(done!.providerMeta.promptTokens).toBe(8);
    expect(done!.providerMeta.completionTokens).toBe(7);
  });

  it('hits the Interactions endpoint with x-goog-api-key + Api-Revision headers', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse('hi')));
    const adapter = new GeminiAdapter({
      apiKey: 'TEST_KEY',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await collect(adapter.stream(makeReq()));

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('TEST_KEY');
    expect(headers['Api-Revision']).toBe('2026-05-20');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('gemini-3-flash-preview');
    expect(body.stream).toBe(true);
    expect(body.input).toBe('hi');
  });

  it('uses req.pin.model in the outbound request body, overriding env/default (Codex review #1)', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse('hi')));
    // No model opt and no env — would default to gemini-3-flash-preview.
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });
    const chunks = await collect(
      adapter.stream(makeReq({ pin: { provider: 'gemini', model: 'gemini-1.5-pro' } })),
    );
    const body = JSON.parse(fetchStub.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe('gemini-1.5-pro');
    const done = chunks.find((c) => c.type === 'done') as
      | { type: 'done'; providerMeta: { model: string } }
      | undefined;
    expect(done!.providerMeta.model).toBe('gemini-1.5-pro');
  });

  it('concatenates multi-turn messages into the input string with role labels', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse('ok')));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await collect(
      adapter.stream(
        makeReq({
          messages: [
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
            { role: 'user', content: 'three' },
          ],
        }),
      ),
    );

    const body = JSON.parse(fetchStub.mock.calls[0]![1]!.body as string);
    expect(body.input).toBe('USER: one\n\nASSISTANT: two\n\nUSER: three');
  });

  it('throws ProviderError with mapped code on non-200', async () => {
    const fetchStub = jest.fn(
      async () =>
        new Response('not allowed', { status: 401 }),
    );
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await expect(collect(adapter.stream(makeReq()))).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'auth_error',
    });
  });

  it('throws ProviderError on 429 mapped to rate_limited', async () => {
    const fetchStub = jest.fn(async () => new Response('slow down', { status: 429 }));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await expect(collect(adapter.stream(makeReq()))).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('reports provider_not_configured when no key is available', async () => {
    const previous = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const adapter = new GeminiAdapter();
      await expect(collect(adapter.stream(makeReq()))).rejects.toMatchObject({
        code: 'provider_not_configured',
      });
    } finally {
      if (previous !== undefined) process.env.GOOGLE_API_KEY = previous;
    }
  });

  it('aborts on signal before fetch resolves', async () => {
    const fetchStub = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return sseResponse(happyPathSse('x'));
    });
    const controller = new AbortController();
    controller.abort();
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });
    const chunks = await collect(adapter.stream(makeReq({ signal: controller.signal })));
    // Aborted before fetch returns → adapter exits silently (no token, no done).
    expect(chunks).toEqual([]);
  });
});
