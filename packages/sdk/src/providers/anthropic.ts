// Anthropic streaming adapter.
//
// Wraps `client.messages.create({ stream: true })`. Anthropic's wire format
// differs from OpenAI's in two ways we care about:
//   1. `system` is a top-level field, not a message — we extract any system
//      messages from `req.messages` and concatenate them.
//   2. Stream events are typed (`message_start`, `content_block_delta`,
//      `message_delta`, `message_stop`) — we only emit tokens for text
//      `content_block_delta` events and harvest usage from `message_start`
//      (prompt) + `message_delta` (output).
//
// Failure model + abort behavior matches OpenAI adapter — see that file's
// docstring.

import Anthropic from '@anthropic-ai/sdk';
import {
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
} from '@anthropic-ai/sdk';
import type { ProviderAdapter } from './types';
import type { ChatMessage, ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_MAX_TOKENS = 1024;

type AnthropicRole = 'user' | 'assistant';

export interface AnthropicAdapterOptions {
  /** Override for tests — inject a stub client instead of constructing one. */
  client?: Pick<Anthropic, 'messages'>;
  /** Override env-read API key for tests. */
  apiKey?: string;
  /** Override model for tests; production reads ANTHROPIC_MODEL env. */
  model?: string;
  /** max_tokens is required by the Anthropic API. Default 1024. */
  maxTokens?: number;
}

export class AnthropicProvider implements ProviderAdapter {
  readonly name = 'anthropic' as const;

  constructor(private readonly opts: AnthropicAdapterOptions = {}) {}

  isConfigured(): boolean {
    const key = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    return typeof key === 'string' && key.length > 0;
  }

  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const model = this.opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    const maxTokens = this.opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const client = this.opts.client ?? this.buildClient();

    const { system, messages } = splitSystem(req.messages);

    let response;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: maxTokens,
          stream: true,
          ...(system ? { system } : {}),
          messages,
        },
        { signal: req.signal },
      );
    } catch (err) {
      if (req.signal?.aborted) return;
      throw mapAnthropicError(err);
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    try {
      for await (const event of response) {
        if (req.signal?.aborted) return;
        if (event.type === 'message_start') {
          // Anthropic SDK declares usage on message_start; treat defensively.
          const usage = (event as { message?: { usage?: { input_tokens?: number } } }).message
            ?.usage;
          if (usage && typeof usage.input_tokens === 'number') {
            promptTokens = usage.input_tokens;
          }
        } else if (event.type === 'content_block_delta') {
          const delta = (event as { delta?: { type?: string; text?: string } }).delta;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
            yield { type: 'token', content: delta.text };
          }
        } else if (event.type === 'message_delta') {
          const usage = (event as { usage?: { output_tokens?: number } }).usage;
          if (usage && typeof usage.output_tokens === 'number') {
            completionTokens = usage.output_tokens;
          }
        }
        // message_stop / content_block_start / content_block_stop are no-ops here.
      }
    } catch (err) {
      if (err instanceof APIUserAbortError) return;
      throw err;
    }

    yield {
      type: 'done',
      providerMeta: {
        provider: 'anthropic',
        model,
        promptTokens,
        completionTokens,
      },
    };
  }

  private buildClient(): Anthropic {
    const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    return new Anthropic({ apiKey });
  }
}

export const anthropicProvider = new AnthropicProvider();

/**
 * Pull system messages out of the message list. Anthropic accepts a single
 * top-level `system` string, so we concatenate any system messages with
 * blank-line separators and keep the rest as user/assistant turns.
 */
export function splitSystem(messages: ChatMessage[]): {
  system: string | undefined;
  messages: { role: AnthropicRole; content: string }[];
} {
  const sys: string[] = [];
  const rest: { role: AnthropicRole; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      sys.push(m.content);
    } else {
      rest.push({ role: m.role, content: m.content });
    }
  }
  return {
    system: sys.length > 0 ? sys.join('\n\n') : undefined,
    messages: rest,
  };
}

export function mapAnthropicError(err: unknown): ProviderError {
  if (err instanceof AuthenticationError) {
    return new ProviderError('auth_failed', err.message || 'Anthropic auth failed');
  }
  if (err instanceof RateLimitError) {
    return new ProviderError('rate_limited', err.message || 'Anthropic rate limited');
  }
  if (err instanceof APIConnectionError) {
    return new ProviderError('network_error', err.message || 'Anthropic network error');
  }
  if (err instanceof Error) {
    return new ProviderError('provider_error', err.message);
  }
  return new ProviderError('provider_error', 'Unknown Anthropic error');
}
