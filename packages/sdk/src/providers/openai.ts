// OpenAI streaming adapter.
//
// Wraps `openai.chat.completions.create({ stream: true })` and converts the
// SSE chunk stream into our internal ChatStreamChunk shape.
//
// Failure model:
//   - The first `await client.chat.completions.create(...)` call already
//     opens the HTTP connection and validates the request. Any 401 / 4xx /
//     network error throws synchronously here, BEFORE we yield a token —
//     we map that to a typed ProviderError so the router can fail over.
//   - Once we start iterating the SSE stream, errors are mid-stream and we
//     let them propagate (the orchestrator handles partial-content + failed
//     turn).
//   - Abort: we pass req.signal directly to OpenAI's `signal` option. The
//     SDK surfaces APIUserAbortError; we treat that as a clean exit (the
//     orchestrator already knows it cancelled).

import OpenAI from 'openai';
import {
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
} from 'openai';
import type { ProviderAdapter } from './types';
import type { ChatMessage, ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

const DEFAULT_MODEL = 'gpt-4o-mini';

type OpenAIRole = 'system' | 'user' | 'assistant';

export interface OpenAIAdapterOptions {
  /** Override for tests — inject a stub client instead of constructing one. */
  client?: Pick<OpenAI, 'chat'>;
  /** Override env-read API key for tests. */
  apiKey?: string;
  /** Override model for tests; production reads OPENAI_MODEL env. */
  model?: string;
}

export class OpenAIProvider implements ProviderAdapter {
  readonly name = 'openai' as const;

  constructor(private readonly opts: OpenAIAdapterOptions = {}) {}

  isConfigured(): boolean {
    const key = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    return typeof key === 'string' && key.length > 0;
  }

  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const model = this.opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    const client = this.opts.client ?? this.buildClient();

    let response;
    try {
      response = await client.chat.completions.create(
        {
          model,
          stream: true,
          stream_options: { include_usage: true },
          messages: req.messages.map(toOpenAIMessage),
        },
        { signal: req.signal },
      );
    } catch (err) {
      // Honor a pre-flight abort cleanly — the orchestrator already knows.
      if (req.signal?.aborted) return;
      throw mapOpenAIError(err);
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for await (const chunk of response) {
        if (req.signal?.aborted) return;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'token', content: delta };
        }
        // Usage arrives on the final chunk when stream_options.include_usage is set.
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }
      }
    } catch (err) {
      if (err instanceof APIUserAbortError) return;
      throw err;
    }

    yield {
      type: 'done',
      providerMeta: {
        provider: 'openai',
        model,
        promptTokens,
        completionTokens,
      },
    };
  }

  private buildClient(): OpenAI {
    const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
    return new OpenAI({ apiKey });
  }
}

export const openaiProvider = new OpenAIProvider();

function toOpenAIMessage(m: ChatMessage): { role: OpenAIRole; content: string } {
  return { role: m.role, content: m.content };
}

/**
 * Map an OpenAI SDK error to a ProviderError. The orchestrator inspects
 * `code` and the WS error frame surfaces it as `error.code` — keep these
 * stable.
 */
export function mapOpenAIError(err: unknown): ProviderError {
  if (err instanceof AuthenticationError) {
    return new ProviderError('auth_failed', err.message || 'OpenAI auth failed');
  }
  if (err instanceof RateLimitError) {
    return new ProviderError('rate_limited', err.message || 'OpenAI rate limited');
  }
  if (err instanceof APIConnectionError) {
    return new ProviderError('network_error', err.message || 'OpenAI network error');
  }
  if (err instanceof Error) {
    return new ProviderError('provider_error', err.message);
  }
  return new ProviderError('provider_error', 'Unknown OpenAI error');
}
