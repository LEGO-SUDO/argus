// Google Gemini streaming adapter — Generative Language API (v1beta).
//
//   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse
//   Headers:  x-goog-api-key, Content-Type: application/json
//   Body:     { contents: [{ role: 'user'|'model', parts: [{text}] }],
//               systemInstruction?: { parts: [{text}] } }
//   Response: Server-Sent Events — each `data:` line is one
//             GenerateContentResponse chunk:
//               { candidates: [{ content: { parts: [{text}], role: 'model' },
//                                finishReason }],
//                 usageMetadata: { promptTokenCount, candidatesTokenCount,
//                                  totalTokenCount } }
//
// Plain `fetch` (no vendor SDK) so we own the streaming shape directly. The
// `?alt=sse` query param makes the endpoint emit proper SSE instead of a
// streamed JSON array.
//
// Role mapping: user→'user', assistant→'model'. `system` messages are pulled
// into Gemini's dedicated `systemInstruction` field rather than inlined.
//
// Failure model matches OpenAI/Anthropic adapters: non-200 before any text →
// ProviderError pre-first-token (router fails over). Network error mid-stream →
// propagates to the orchestrator which terminates the turn.

import type { ProviderAdapter } from './types';
import type { ChatMessage, ChatStreamChunk, ChatStreamRequest } from '../index';
import { ProviderError } from '../index';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiAdapterOptions {
  /** Override the env-derived API key (tests). */
  apiKey?: string;
  /** Override model (tests; production reads GOOGLE_MODEL env). */
  model?: string;
  /** Override fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Override the full request URL (tests). When set, used verbatim. */
  endpoint?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  public readonly name = 'gemini' as const;

  constructor(private readonly opts: GeminiAdapterOptions = {}) {}

  isConfigured(): boolean {
    return Boolean(this.opts.apiKey ?? process.env.GOOGLE_API_KEY);
  }

  // Current generally-available Gemini text models. Matches the gemini:* keys
  // in cost.ts PRICEBOOK; the catalog accessor joins on (provider, model).
  listModels(): string[] {
    return ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
  }

  async *stream(req: ChatStreamRequest): AsyncIterable<ChatStreamChunk> {
    const apiKey = this.opts.apiKey ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new ProviderError('provider_not_configured', 'GOOGLE_API_KEY not set');
    }
    // Pin's model wins over opts/env/default (matches openai/anthropic).
    const model = req.pin?.model ?? this.opts.model ?? process.env.GOOGLE_MODEL ?? DEFAULT_MODEL;
    const endpoint =
      this.opts.endpoint ??
      `${BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const fetchImpl = this.opts.fetchImpl ?? fetch;

    const { contents, systemInstruction } = messagesToContents(req.messages);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    for await (const evt of parseSseStream(response.body, req.signal)) {
      const data = evt.data;
      if (!data || typeof data !== 'object') continue;

      const parts = data.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const text: unknown = part?.text;
          if (typeof text === 'string' && text.length > 0) {
            yield { type: 'token', content: text };
          }
        }
      }

      // Usage lands on the final chunk(s); keep the latest seen.
      const usage = data.usageMetadata;
      if (usage) {
        promptTokens = numberOrUndefined(usage.promptTokenCount);
        completionTokens = numberOrUndefined(usage.candidatesTokenCount);
      }
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

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/**
 * Convert the provider-neutral message list into Gemini's `contents` array.
 * `system` messages are collected into `systemInstruction` (Gemini's dedicated
 * field); user→'user', assistant→'model'.
 */
function messagesToContents(messages: ChatMessage[]): {
  contents: GeminiContent[];
  systemInstruction?: string;
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }
  return {
    contents,
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  };
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
      // Gemini SSE uses CRLF (events separated by \r\n\r\n). Strip CR so the
      // \n\n block split and `data:`-line parsing work regardless of endings.
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
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
