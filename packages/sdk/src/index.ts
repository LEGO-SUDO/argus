// @argus/sdk — OTel-instrumented multi-provider LLM SDK.
//
// Public surface (LOCKED — apps/api compiles against these shapes):
//   - ChatMessage, ChatStreamChunk, ProviderMeta, ChatStreamRequest types
//   - ProviderError class
//   - `chat.stream(req)` — async generator that drives the router, emits an
//     OTel `llm.chat` span around the lifecycle, and accumulates output for
//     the span's `llm.output` event.
//
// Internal modules (subject to refactor — not re-exported by default):
//   - router.ts            priority + failover across configured providers
//   - providers/*.ts       per-provider adapters
//   - otel.ts              span emission per HLD §D4
//   - cost.ts              static pricebook → micro-USD per token
//
// See router.ts for the priority/failover state machine and otel.ts for the
// span shape that flows into the workers projection consumer.

import { defaultRouter } from './router';
import { startLlmSpan } from './otel';
import type { ProviderName } from './providers/types';

// ---- Public types (LOCKED) -------------------------------------------------

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
 * Error thrown from the SDK when a provider fails before yielding any token
 * (network, 4xx/5xx, auth, no-providers-configured). The StreamOrchestrator
 * inspects `code` and surfaces it on the WS error frame.
 *
 * Codes used in this package:
 *   auth_failed              provider returned 401 / 403
 *   rate_limited             provider returned 429
 *   network_error            connection/timeout before headers
 *   provider_error           any other provider-side error
 *   empty_stream             provider produced no tokens (router-only)
 *   no_providers_configured  MOCK_PROVIDER=false and no API keys set
 */
export class ProviderError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

// Re-export the typed provider name so apps can switch on it without
// reaching into the providers/ subtree.
export type { ProviderName } from './providers/types';

// ---- Public surface --------------------------------------------------------

/**
 * The apps/api gateway calls this surface and nothing else from packages/sdk.
 *
 * Lifecycle (per HLD §D3/D4):
 *   1. Start an `llm.chat` span seeded with conversation/user/message ids.
 *   2. Stream tokens from the router (which handles provider failover until
 *      first token).
 *   3. Accumulate output content for the span's `llm.output` event.
 *   4. On `done` chunk → succeed the span (attach providerMeta + cost attrs).
 *   5. On `req.signal` abort → cancel the span; still attach the partial
 *      output so the trace shows what we'd produced.
 *   6. On thrown error → fail the span with `llm.error_code`.
 */
export const chat = {
  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const span = startLlmSpan(req);
    let accumulated = '';
    let provider: ProviderName | 'unknown' = 'unknown';
    let model = 'unknown';

    try {
      for await (const chunk of defaultRouter.stream(req)) {
        if (chunk.type === 'token') {
          accumulated += chunk.content;
          yield chunk;
        } else if (chunk.type === 'done') {
          provider = (chunk.providerMeta.provider as ProviderName) ?? 'unknown';
          model = chunk.providerMeta.model;
          // Emit `done` to the orchestrator BEFORE we close the span — the
          // orchestrator needs the meta to persist its terminal frame, but
          // the span close is purely observability and shouldn't gate it.
          yield chunk;
          span.succeed(chunk.providerMeta, accumulated);
          return;
        }
      }

      // Iterator exhausted without a `done` chunk (mock with empty MOCK_RESPONSE,
      // or an adapter that forgot to emit one). Treat as success with whatever
      // we accumulated — better than leaking an unended span.
      span.succeed(
        { provider: 'unknown', model: 'unknown' },
        accumulated,
      );
    } catch (err) {
      if (req.signal?.aborted) {
        span.cancel(provider, model, accumulated);
        return;
      }
      const code = err instanceof ProviderError ? err.code : 'sdk_error';
      span.fail(provider, model, code, err, accumulated);
      throw err;
    } finally {
      // Safety net for abort that happened between iterator hops without
      // throwing — the span MUST end exactly once. .succeed/.cancel/.fail
      // are all idempotent (see otel.ts endOnce); this catches the silent
      // abort case.
      if (req.signal?.aborted) {
        span.cancel(provider, model, accumulated);
      }
    }
  },
};
