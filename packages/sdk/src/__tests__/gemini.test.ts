// Tests for the Gemini adapter (Generative Language API, fetch-based).
//
// We stub `fetch` to return a synthesized SSE body matching the real
// `:streamGenerateContent?alt=sse` shape: CRLF-separated `data:` blocks, each
// a GenerateContentResponse chunk with candidates[].content.parts[].text and a
// trailing usageMetadata.

import { GeminiAdapter } from '../providers/gemini';
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

// Real Gemini SSE: `data: {json}` blocks separated by CRLF (\r\n\r\n).
function dataBlock(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\r\n\r\n`;
}

// Two streamed text chunks + a final chunk carrying usageMetadata, mirroring
// how the live API drips tokens then reports usage on the last event.
function happyPathSse(part1 = 'Hello, ', part2 = 'how are you?', inputTokens = 8, outputTokens = 7): string {
  return (
    dataBlock({
      candidates: [{ content: { parts: [{ text: part1 }], role: 'model' }, index: 0 }],
    }) +
    dataBlock({
      candidates: [
        { content: { parts: [{ text: part2 }], role: 'model' }, finishReason: 'STOP', index: 0 },
      ],
      usageMetadata: {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        totalTokenCount: inputTokens + outputTokens,
      },
    })
  );
}

describe('GeminiAdapter (Generative Language API)', () => {
  it('isConfigured reflects the API key', () => {
    expect(new GeminiAdapter({ apiKey: 'k' }).isConfigured()).toBe(true);
    expect(new GeminiAdapter({ apiKey: '' }).isConfigured()).toBe(false);
  });

  it('streams text from candidate parts and reports usage on done', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse()));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    const chunks = await collect(adapter.stream(makeReq()));

    const tokens = chunks
      .filter((c) => c.type === 'token')
      .map((c) => (c as { type: 'token'; content: string }).content);
    expect(tokens.join('')).toBe('Hello, how are you?');

    const done = chunks.find((c) => c.type === 'done') as
      | {
          type: 'done';
          providerMeta: { provider: string; model: string; promptTokens?: number; completionTokens?: number };
        }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.providerMeta.provider).toBe('gemini');
    expect(done!.providerMeta.model).toBe('gemini-2.5-flash');
    expect(done!.providerMeta.promptTokens).toBe(8);
    expect(done!.providerMeta.completionTokens).toBe(7);
  });

  it('hits :streamGenerateContent?alt=sse with x-goog-api-key + contents body', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse()));
    const adapter = new GeminiAdapter({
      apiKey: 'TEST_KEY',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await collect(adapter.stream(makeReq()));

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('TEST_KEY');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init!.body as string);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('uses req.pin.model in the request URL + done meta, overriding default', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse()));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });
    const chunks = await collect(
      adapter.stream(makeReq({ pin: { provider: 'gemini', model: 'gemini-2.5-pro' } })),
    );
    const [url] = fetchStub.mock.calls[0]!;
    expect(url).toContain('/models/gemini-2.5-pro:streamGenerateContent');
    const done = chunks.find((c) => c.type === 'done') as
      | { type: 'done'; providerMeta: { model: string } }
      | undefined;
    expect(done!.providerMeta.model).toBe('gemini-2.5-pro');
  });

  it('maps roles (assistant→model) and pulls system into systemInstruction', async () => {
    const fetchStub = jest.fn(async () => sseResponse(happyPathSse()));
    const adapter = new GeminiAdapter({
      apiKey: 'k',
      fetchImpl: fetchStub as unknown as typeof fetch,
    });

    await collect(
      adapter.stream(
        makeReq({
          messages: [
            { role: 'system', content: 'be terse' },
            { role: 'user', content: 'one' },
            { role: 'assistant', content: 'two' },
            { role: 'user', content: 'three' },
          ],
        }),
      ),
    );

    const body = JSON.parse(fetchStub.mock.calls[0]![1]!.body as string);
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'one' }] },
      { role: 'model', parts: [{ text: 'two' }] },
      { role: 'user', parts: [{ text: 'three' }] },
    ]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be terse' }] });
  });

  it('throws ProviderError with mapped code on non-200 (401 → auth_error)', async () => {
    const fetchStub = jest.fn(async () => new Response('not allowed', { status: 401 }));
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
      return sseResponse(happyPathSse());
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
