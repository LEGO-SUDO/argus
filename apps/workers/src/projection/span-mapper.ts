// Pure mapper: OTLP span -> { inference, traceEvents }.
//
// Owns ZERO Prisma calls. The service consumes the verdict and decides
// update vs insert at the DB layer (see failover-detector / projection.service).
//
// The cost calculator runs in @argus/sdk and attaches micro-USD values as
// span attributes (HLD §Forward-Compat). This mapper never re-derives pricing.
//
// Phase B: also reads the four control-plane attributes (llm.kind + the three
// FK attrs). `llm.kind` is mapped against the locked producer-kind list; a
// missing value defaults to `chat` (Phase A producers), and an unrecognized
// value is bucketed to `unknown` with a structured warn (HLD §Forward-Compat
// Locks). These attributes are NOT part of the contracts-owned
// OtelAttributesSchema, so the projection service must hand the mapper a span
// whose `attributes` still carries the raw keys (zod strips unknown keys).
import { Logger } from '@nestjs/common';
import {
  OTEL_ATTRS,
  SPAN_EVENT_NAMES,
  LLM_KIND,
  LLM_SAMPLE_WORKSPACE_ID,
  LLM_REPLAY_OF_INFERENCE_ID,
  LLM_CLASSIFIER_FOR_MESSAGE_ID,
  type InferenceKind,
  type OtlpSpan,
  type InferenceUpdate,
  type TraceEventInsert,
} from '@argus/contracts';
import { previewOf } from './preview';

// Verdict the mapper produces. Extends the contracts-owned InferenceUpdate with
// the Phase B columns the projection consumer now writes. Kept local to the
// workers package — the contracts InferenceUpdate stays the cross-pane shape.
export interface PhaseBInferenceVerdict extends InferenceUpdate {
  kind: InferenceKind;
  classifierForMessageId: string | null;
  replayOfInferenceId: string | null;
  sampleWorkspaceId: string | null;
}

export interface SpanProjectionPhaseB {
  inference: PhaseBInferenceVerdict;
  traceEvents: TraceEventInsert[];
}

const logger = new Logger('SpanMapper');

// The kinds a producer (SDK span / heartbeat emitter) may legitimately emit.
// `unknown` is intentionally excluded — it is reserved for the absorption
// bucket, never an accepted incoming value.
const PRODUCER_KINDS: readonly InferenceKind[] = [
  'chat',
  'classifier',
  'replay',
  'sample',
  'heartbeat',
];

function unixNanoToDate(value: string | number): Date {
  // OTLP unix-nano is typically a stringified bigint to preserve precision.
  // ms is good enough for our latency math; we lose sub-ms but the column is INT ms.
  const big =
    typeof value === 'string' ? BigInt(value) : BigInt(Math.trunc(Number(value)));
  const ms = Number(big / 1_000_000n);
  return new Date(ms);
}

// Map a raw `llm.kind` attribute value onto the inference kind.
//   - missing/null            -> chat   (legacy / Phase A producers; no warn)
//   - a recognized producer   -> that kind
//   - anything else           -> unknown + structured warn carrying the value
function resolveKind(raw: unknown): InferenceKind {
  if (raw === undefined || raw === null) return 'chat';
  if (typeof raw === 'string' && (PRODUCER_KINDS as readonly string[]).includes(raw)) {
    return raw as InferenceKind;
  }
  logger.warn(
    `[phase-b] unrecognized llm.kind value '${String(raw)}' -> kind=unknown ` +
      `(forward-compat absorption; producer version skew)`,
  );
  return 'unknown';
}

// Nullable string FK attribute. No UUID-shape validation here — the DB FK
// constraint is the authority; malformed values surface via projection error
// capture at write time (Task 26).
function optFk(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function mapSpanToProjection(span: OtlpSpan): SpanProjectionPhaseB {
  const attrs = span.attributes;
  // Phase B attributes are not declared in the (contracts-owned) typed schema,
  // so index them through a widened view of the same attribute map.
  const ext = attrs as unknown as Record<string, unknown>;

  const startedAt = unixNanoToDate(span.startTimeUnixNano);
  const endedAt = unixNanoToDate(span.endTimeUnixNano);
  const latencyMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

  // Previews are derived from the body events the SDK already emits — the
  // dedicated `llm.*_preview` attributes are never set on the write path
  // (REVIEW-BRIEF Finding 1). We still PREFER an explicit attribute when one is
  // present (forward-compat if a future producer sets it), falling back to the
  // body. `evt.body ?? evt.attributes` mirrors what we store as the payload, so
  // the preview is derived from the exact same source of truth.
  const inputEvent = span.events.find((e) => e.name === SPAN_EVENT_NAMES.LLM_INPUT);
  const outputEvent = span.events.find((e) => e.name === SPAN_EVENT_NAMES.LLM_OUTPUT);
  const inputPreview =
    attrs[OTEL_ATTRS.LLM_INPUT_PREVIEW] ?? previewOf(inputEvent?.body ?? inputEvent?.attributes);
  const outputPreview =
    attrs[OTEL_ATTRS.LLM_OUTPUT_PREVIEW] ?? previewOf(outputEvent?.body ?? outputEvent?.attributes);

  const inference: PhaseBInferenceVerdict = {
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
    inputPreview,
    outputPreview,
    traceId: span.traceId,
    spanId: span.spanId,
    errorCode: attrs[OTEL_ATTRS.LLM_ERROR_CODE],
    // ---- Phase B ----
    kind: resolveKind(ext[LLM_KIND]),
    classifierForMessageId: optFk(ext[LLM_CLASSIFIER_FOR_MESSAGE_ID]),
    replayOfInferenceId: optFk(ext[LLM_REPLAY_OF_INFERENCE_ID]),
    sampleWorkspaceId: optFk(ext[LLM_SAMPLE_WORKSPACE_ID]),
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
