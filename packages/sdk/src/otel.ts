// OTel span emission for chat.stream.
//
// The architecture's whole point depends on this — every chat.stream call
// produces a span that flows: SDK → OTel Collector → Redpanda `traces`
// topic → workers projection consumer → Postgres `inferences` row enrichment.
//
// Span shape (per HLD §D4):
//   - name:        'llm.chat'
//   - attributes:  llm.provider, llm.model, llm.prompt_tokens,
//                  llm.completion_tokens, llm.status,
//                  llm.prompt_cost_usd_micros, llm.completion_cost_usd_micros,
//                  conversation.id, user.id, message.id, turn.index,
//                  optionally llm.error_code on failure.
//   - events:      'llm.input'  with `body` (full request messages JSON)
//                  'llm.output' with `body` (full assistant content)
//                  Both capped at 100 KB and marked `truncated: true` when
//                  over — the workers consumer enforces the same cap when
//                  it stores trace_events.payload, but capping here too
//                  keeps the OTel wire payload bounded.
//
// We use `trace.getTracer('@argus/sdk')` rather than initializing an SDK in
// this package. The host process (apps/api/src/main.ts) initializes the
// NodeSDK with an OTLP exporter; this module just emits into whatever tracer
// provider is registered globally. If none is registered the OTel API
// becomes a no-op tracer — safe for unit tests.

import { trace, SpanStatusCode, type Span, type SpanOptions, context as otelContext } from '@opentelemetry/api';
import {
  OTEL_ATTRS,
  SPAN_EVENT_NAMES,
  type LlmStatus,
} from '@argus/contracts';
import type { ChatStreamRequest, ProviderMeta } from './index';
import { computeCost } from './cost';
import type { ProviderName } from './providers/types';

const TRACER_NAME = '@argus/sdk';
const SPAN_NAME = 'llm.chat';

/** Hard cap matches the workers projection (apps/workers/src/projection/payload-cap.ts). */
export const SPAN_EVENT_BODY_CAP_BYTES = 100 * 1024;

export interface LlmSpan {
  /** End successfully with terminal attributes + output body event. */
  succeed(meta: ProviderMeta, outputContent: string): void;
  /** Pre/mid-stream cancel — orchestrator already knows; we mark and end. */
  cancel(provider: ProviderName | 'unknown', model: string, partialOutput: string): void;
  /** Terminal failure — attaches llm.error_code and records the exception. */
  fail(provider: ProviderName | 'unknown', model: string, errorCode: string, err: unknown, partialOutput: string): void;
}

/**
 * Start an `llm.chat` span seeded with request-level attributes and an
 * `llm.input` event. Returns a small handle the caller uses to terminate
 * the span on success / cancel / fail.
 */
export function startLlmSpan(req: ChatStreamRequest): LlmSpan {
  const tracer = trace.getTracer(TRACER_NAME);
  const opts: SpanOptions = {
    attributes: {
      [OTEL_ATTRS.CONVERSATION_ID]: req.conversationId,
      [OTEL_ATTRS.USER_ID]: req.userId,
      [OTEL_ATTRS.MESSAGE_ID]: req.messageId,
      [OTEL_ATTRS.TURN_INDEX]: req.turnIndex,
      [OTEL_ATTRS.LLM_STATUS]: 'streaming' satisfies LlmStatus,
    },
  };

  // startActiveSpan binds the span to the current context — any child spans
  // the provider SDK happens to start (e.g. the HTTP client's own
  // instrumentation) will nest underneath.
  let span!: Span;
  tracer.startActiveSpan(SPAN_NAME, opts, otelContext.active(), (s) => {
    span = s;
  });

  // Emit `llm.input` immediately so even a failed-before-first-token request
  // has its prompt captured in the trace.
  const inputBody = safeJsonStringify({ messages: req.messages });
  addBodyEvent(span, SPAN_EVENT_NAMES.LLM_INPUT, inputBody);

  let ended = false;
  const endOnce = (): void => {
    if (ended) return;
    ended = true;
    span.end();
  };

  return {
    succeed(meta, outputContent) {
      span.setAttribute(OTEL_ATTRS.LLM_PROVIDER, meta.provider);
      span.setAttribute(OTEL_ATTRS.LLM_MODEL, meta.model);
      if (typeof meta.promptTokens === 'number') {
        span.setAttribute(OTEL_ATTRS.LLM_PROMPT_TOKENS, meta.promptTokens);
      }
      if (typeof meta.completionTokens === 'number') {
        span.setAttribute(OTEL_ATTRS.LLM_COMPLETION_TOKENS, meta.completionTokens);
      }
      const { promptMicros, completionMicros } = computeCost(
        meta.provider as ProviderName,
        meta.model,
        meta.promptTokens,
        meta.completionTokens,
      );
      span.setAttribute(OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS, promptMicros);
      span.setAttribute(OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS, completionMicros);
      span.setAttribute(OTEL_ATTRS.LLM_STATUS, 'ok' satisfies LlmStatus);
      addBodyEvent(span, SPAN_EVENT_NAMES.LLM_OUTPUT, outputContent);
      span.setStatus({ code: SpanStatusCode.OK });
      endOnce();
    },

    cancel(provider, model, partialOutput) {
      span.setAttribute(OTEL_ATTRS.LLM_PROVIDER, provider);
      span.setAttribute(OTEL_ATTRS.LLM_MODEL, model);
      span.setAttribute(OTEL_ATTRS.LLM_STATUS, 'canceled' satisfies LlmStatus);
      addBodyEvent(span, SPAN_EVENT_NAMES.LLM_OUTPUT, partialOutput);
      span.setStatus({ code: SpanStatusCode.OK, message: 'canceled' });
      endOnce();
    },

    fail(provider, model, errorCode, err, partialOutput) {
      span.setAttribute(OTEL_ATTRS.LLM_PROVIDER, provider);
      span.setAttribute(OTEL_ATTRS.LLM_MODEL, model);
      span.setAttribute(OTEL_ATTRS.LLM_STATUS, 'failed' satisfies LlmStatus);
      span.setAttribute(OTEL_ATTRS.LLM_ERROR_CODE, errorCode);
      addBodyEvent(span, SPAN_EVENT_NAMES.LLM_OUTPUT, partialOutput);
      if (err instanceof Error) {
        span.recordException(err);
      }
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
      endOnce();
    },
  };
}

// ---- helpers ---------------------------------------------------------------

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"<unserializable>"';
  }
}

/**
 * Attach a `body`-shaped span event with byte-cap enforcement. OTel events
 * accept arbitrary attribute maps; we use `body` as the canonical key and
 * `truncated` as the over-cap marker so the projection consumer doesn't have
 * to guess.
 */
function addBodyEvent(span: Span, name: string, body: string): void {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes <= SPAN_EVENT_BODY_CAP_BYTES) {
    span.addEvent(name, { body, truncated: false });
    return;
  }
  const truncated = sliceUtf8(body, SPAN_EVENT_BODY_CAP_BYTES);
  span.addEvent(name, { body: truncated, truncated: true, original_bytes: bytes });
}

function sliceUtf8(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  let end = maxBytes;
  // Walk back if we'd split a multi-byte UTF-8 codepoint.
  while (end > 0) {
    const b = buf[end];
    if (b === undefined || (b & 0xc0) !== 0x80) break;
    end -= 1;
  }
  return buf.slice(0, end).toString('utf8');
}
