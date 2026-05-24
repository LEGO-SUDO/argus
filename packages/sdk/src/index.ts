// @argus/sdk — OTel-instrumented multi-provider LLM SDK.
//
// PHASE A STUB. The full SDK (router, providers, context, cost, OTel spans)
// is its own LLD. This stub exposes ONLY the `chat.stream(...)` surface that
// the apps/api StreamOrchestrator depends on, plus a deterministic mock
// provider so the gateway is exercisable end-to-end without API keys.
//
// What's stubbed vs real:
//   - chat.stream signature — STABLE; the real SDK must keep this shape.
//   - mock provider — deterministic token sequence drawn from MOCK_RESPONSE
//     env or a built-in greeting; useful for the apps/api smoke test.
//   - router / failover / circuit breaker — NOT implemented; the stub picks
//     `mock` unconditionally regardless of MOCK_PROVIDER env.
//   - cost calculator + OTel span emission — NOT implemented at the stub
//     boundary; the real SDK will emit spans, the stub is silent.

/** Chat message in OpenAI/Anthropic-compatible shape. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Single streaming chunk yielded by `chat.stream`. */
export type ChatStreamChunk =
  | { type: 'token'; content: string }
  | { type: 'done'; providerMeta: ProviderMeta };

export interface ProviderMeta {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatStreamRequest {
  messages: ChatMessage[];
  conversationId: string;
  turnIndex: number;
  userId: string;
  messageId: string;
  /** Caller-controlled cancellation. Aborting must stop the iterator promptly. */
  signal?: AbortSignal;
}

/**
 * Error thrown from the SDK when the provider fails before yielding any
 * token (network error, 4xx/5xx, auth). The StreamOrchestrator inspects
 * `code` and surfaces it on the WS error frame.
 */
export class ProviderError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

/**
 * The apps/api gateway calls this surface and nothing else from packages/sdk.
 * The real SDK will swap the implementation in while preserving the shape.
 */
export const chat = {
  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    // Deterministic mock: split MOCK_RESPONSE (or default) into whitespace
    // chunks. Useful for the WS smoke test — no API key required.
    const text =
      process.env.MOCK_RESPONSE ??
      'Hello from the mock provider. This is a deterministic streaming response.';
    const tokens = text.match(/\S+\s*/g) ?? [text];

    for (const tok of tokens) {
      if (req.signal?.aborted) return;
      // Surface in a microtask so cancel can interleave naturally.
      await Promise.resolve();
      yield { type: 'token', content: tok };
    }

    yield {
      type: 'done',
      providerMeta: {
        provider: 'mock',
        model: 'mock-1',
        promptTokens: req.messages.reduce((n, m) => n + m.content.length, 0),
        completionTokens: text.length,
      },
    };
  },
};
