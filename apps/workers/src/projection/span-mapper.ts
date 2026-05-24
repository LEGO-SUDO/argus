// Pure mapper: OTLP span -> { inferenceUpdate, traceEventInserts }.
//
// Owns ZERO Prisma calls. The service consumes the verdict and decides
// update vs insert at the DB layer (see failover-detector / projection.service).
//
// The cost calculator runs in @argus/sdk and attaches micro-USD values as
// span attributes (HLD §Forward-Compat). This mapper never re-derives pricing.
import {
  OTEL_ATTRS,
  type OtlpSpan,
  type SpanProjection,
  type TraceEventInsert,
} from '@argus/contracts';

function unixNanoToDate(value: string | number): Date {
  // OTLP unix-nano is typically a stringified bigint to preserve precision.
  // ms is good enough for our latency math; we lose sub-ms but the column is INT ms.
  const big =
    typeof value === 'string' ? BigInt(value) : BigInt(Math.trunc(Number(value)));
  const ms = Number(big / 1_000_000n);
  return new Date(ms);
}

export function mapSpanToProjection(span: OtlpSpan): SpanProjection {
  const attrs = span.attributes;
  const startedAt = unixNanoToDate(span.startTimeUnixNano);
  const endedAt = unixNanoToDate(span.endTimeUnixNano);
  const latencyMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

  const inference: SpanProjection['inference'] = {
    messageId: attrs[OTEL_ATTRS.MESSAGE_ID],
    conversationId: attrs[OTEL_ATTRS.CONVERSATION_ID],
    userId: attrs[OTEL_ATTRS.USER_ID],
    provider: attrs[OTEL_ATTRS.LLM_PROVIDER],
    model: attrs[OTEL_ATTRS.LLM_MODEL],
    status: attrs[OTEL_ATTRS.LLM_STATUS],
    latencyMs,
    promptTokens: attrs[OTEL_ATTRS.LLM_PROMPT_TOKENS],
    completionTokens: attrs[OTEL_ATTRS.LLM_COMPLETION_TOKENS],
    promptCostUsdMicros: attrs[OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS],
    completionCostUsdMicros: attrs[OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS],
    startedAt,
    endedAt,
    inputPreview: attrs[OTEL_ATTRS.LLM_INPUT_PREVIEW],
    outputPreview: attrs[OTEL_ATTRS.LLM_OUTPUT_PREVIEW],
    traceId: span.traceId,
    spanId: span.spanId,
    errorCode: attrs[OTEL_ATTRS.LLM_ERROR_CODE],
  };

  const traceEvents: TraceEventInsert[] = span.events.map((evt) => ({
    traceId: span.traceId,
    spanId: span.spanId,
    messageId: attrs[OTEL_ATTRS.MESSAGE_ID],
    userId: attrs[OTEL_ATTRS.USER_ID],
    name: evt.name,
    payload: evt.body ?? evt.attributes ?? null,
    truncated: false,
  }));

  return { inference, traceEvents };
}
