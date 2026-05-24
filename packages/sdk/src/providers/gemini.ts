// Google Gemini streaming adapter — Interactions API (v1beta).
//
// Google's `/v1beta/models/<name>:streamGenerateContent` endpoint that the
// `@google/generative-ai` package wraps is being replaced by a new unified
// Interactions API:
//
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
//   Headers:  x-goog-api-key, Api-Revision: 2026-05-20
//   Body:     { model, input: string, stream: true }
//   Response: Server-Sent Events with named event types
//               (interaction.created, step.start, step.delta,
//                step.stop, interaction.completed, done)
//
// We implement this with plain `fetch` rather than a vendor SDK because the
// official package still targets the legacy endpoint as of this writing.
//
// Multi-turn limitation: the Interactions API takes `input: string`, not a
// messages array. We concatenate the conversation with role labels into a
// single input string. Loses some fidelity vs proper role-tagged turns but
// is sufficient for the chat UX. When/if Google ships a messages-aware
// shape, this concatenation is the single line to replace.
//
// Event mapping (only model-visible output emitted as tokens):
//   - step.start { step.type: 'thought' }       → enter thought mode (skip text)
//   - step.start { step.type: 'model_output' }  → enter output mode (emit text)
//   - step.delta { delta.type: 'text' }         → if in output mode, emit token
//   - step.delta { delta.type: 'thought_signature' } → skip
//   - interaction.completed                     → extract usage → emit done frame
//   - done                                      → close
//
// Failure model matches OpenAI/Anthropic adapters: non-200 before any text
// → ProviderError pre-first-token (router fails over). Network error mid-
// stream → propagates to orchestrator which terminates the turn.

import type { ProviderAdapter } from './types';
import type { ChatMessage, ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const API_REVISION = '2026-05-20';

export interface GeminiAdapterOptions {
  /** Override the env-derived API key (tests). */
  apiKey?: string;
  /** Override model (tests; production reads GOOGLE_MODEL env). */
  model?: string;
  /** Override fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  public readonly name = 'gemini' as const;

  constructor(private readonly opts: GeminiAdapterOptions = {}) {}

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey ?? process.env.GOOGLE_API_KEY);
  }

  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const apiKey = this.opts.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new ProviderError('provider_not_configured', 'GOOGLE_API_KEY not set');
    }
    const model = this.opts.model ?? process.env.GOOGLE_MODEL ?? DEFAULT_MODEL;
    const endpoint = this.opts.endpoint ?? ENDPOINT;
    const fetchImpl = this.opts.fetchImpl ?? fetch;

    const input = messagesToInput(req.messages);

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
          'Api-Revision': API_REVISION,
        },
        body: JSON.stringify({ model, input, stream: true }),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal?.aborted) return;
      throw new ProviderError('network_error', errorMessage(err));
    }

    if (!response.ok) {
      const text = await safeReadText(response);
      throw new ProviderError(
        mapHttpStatusToCode(response.status),
        `gemini ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    if (!response.body) {
      throw new ProviderError('empty_response', 'gemini returned no response body');
    }

    let currentStepType: 'thought' | 'model_output' | 'unknown' = 'unknown';
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for await (const evt of parseSseStream(response.body, req.signal)) {
      if (evt.event === 'step.start') {
        const stepType = evt.data?.step?.type;
        currentStepType =
          stepType === 'thought' || stepType === 'model_output' ? stepType : 'unknown';
        continue;
      }
      if (evt.event === 'step.delta') {
        const deltaType = evt.data?.delta?.type;
        if (currentStepType === 'model_output' && deltaType === 'text') {
          const text: string | undefined = evt.data?.delta?.text;
          if (typeof text === 'string' && text.length > 0) {
            yield { type: 'token', content: text };
          }
        }
        continue;
      }
      if (evt.event === 'interaction.completed') {
        const usage = evt.data?.interaction?.usage;
        if (usage) {
          promptTokens = numberOrUndefined(usage.total_input_tokens);
          completionTokens = numberOrUndefined(usage.total_output_tokens);
        }
        continue;
      }
      if (evt.event === 'done') {
        break;
      }
      // step.stop, interaction.status_update, anything else — no-op
    }

    yield {
      type: 'done',
      providerMeta: {
        provider: 'gemini',
        model,
        promptTokens,
        completionTokens,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers

function messagesToInput(messages: ChatMessage[]): string {
  // Single-turn fast path: just send the user content directly.
  if (messages.length === 1 && messages[0]?.role === 'user') {
    return messages[0].content;
  }
  // Multi-turn: concatenate with role labels. Loses role semantics but the
  // Interactions API doesn't accept a messages array as of Api-Revision
  // 2026-05-20.
  return messages
    .map((m) => {
      const label = m.role === 'assistant' ? 'ASSISTANT' : m.role === 'system' ? 'SYSTEM' : 'USER';
      return `${label}: ${m.content}`;
    })
    .join('\n\n');
}

interface SseEvent {
  event: string;
  // Provider payloads vary; loose typing here is intentional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

/**
 * Parse a `ReadableStream<Uint8Array>` SSE response into a stream of
 * `{ event, data }` records. Yields per complete event block (terminated
 * by `\n\n`).
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseSseBlock(block);
        if (evt) yield evt;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return { event: eventName, data: null };
  try {
    return { event: eventName, data: JSON.parse(raw) };
  } catch {
    return { event: eventName, data: raw };
  }
}

function mapHttpStatusToCode(status: number): string {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 404) return 'model_not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_5xx';
  return 'provider_error';
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Default singleton consumed by the router. Tests construct their own
// `new GeminiAdapter({ apiKey, fetchImpl })` to inject a stub fetch.
export const geminiProvider = new GeminiAdapter();
