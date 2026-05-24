// Projection row shapes — what the projection consumer mutates in Postgres.
//
// These are the shape the consumer hands the database; they are NOT a 1:1
// mirror of the Prisma model (the consumer doesn't write every column — the
// API gateway owns the placeholder insert per HLD §Component Map).

import { z } from 'zod';
import { LlmStatusSchema, OtelAttributesSchema } from './otel-attrs';

// ---------------------------------------------------------------------------
// OTLP span shape (the subset the consumer parses out of the kafka record).
// We don't import from @opentelemetry/api here — the projection consumer
// receives already-parsed objects from the OTLP transformer; this is its
// schema-validated view.
// ---------------------------------------------------------------------------

export const OtlpSpanEventSchema = z.object({
  name: z.string(),
  timeUnixNano: z.string().or(z.number()).optional(),
  attributes: z.record(z.unknown()).optional(),
  // The payload body. SDK attaches input/output JSON as a `body` attribute
  // on the event, capped at 100KB by the projection consumer (HLD §D4).
  body: z.unknown().optional(),
});
export type OtlpSpanEvent = z.infer<typeof OtlpSpanEventSchema>;

export const OtlpSpanSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  name: z.string(),
  startTimeUnixNano: z.string().or(z.number()),
  endTimeUnixNano: z.string().or(z.number()),
  attributes: OtelAttributesSchema,
  events: z.array(OtlpSpanEventSchema).default([]),
  status: z
    .object({
      code: z.number().int().optional(),
      message: z.string().optional(),
    })
    .optional(),
});
export type OtlpSpan = z.infer<typeof OtlpSpanSchema>;

// ---------------------------------------------------------------------------
// Projection verdicts — what the mapper computes from a span before any DB
// write. The service consumes these and runs the actual Prisma calls.
// ---------------------------------------------------------------------------

export const InferenceUpdateSchema = z.object({
  // Identity. messageId is the join key — the gateway already inserted a
  // placeholder row keyed by message_id; the consumer enriches it.
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  userId: z.string().uuid(),
  // Enrichment fields.
  provider: z.string(),
  model: z.string(),
  status: LlmStatusSchema,
  latencyMs: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  promptCostUsdMicros: z.number().int().nonnegative().optional(),
  completionCostUsdMicros: z.number().int().nonnegative().optional(),
  startedAt: z.date(),
  endedAt: z.date(),
  inputPreview: z.string().max(500).optional(),
  outputPreview: z.string().max(500).optional(),
  traceId: z.string(),
  spanId: z.string(),
  errorCode: z.string().optional(),
});
export type InferenceUpdate = z.infer<typeof InferenceUpdateSchema>;

export const TraceEventInsertSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  messageId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  name: z.string(),
  payload: z.unknown(),
  truncated: z.boolean().default(false),
});
export type TraceEventInsert = z.infer<typeof TraceEventInsertSchema>;

// Mapper returns one InferenceUpdate plus zero or more TraceEvent inserts
// (one per span event — typically llm.input + llm.output, sometimes also
// failure events).
export interface SpanProjection {
  inference: InferenceUpdate;
  traceEvents: TraceEventInsert[];
}

// SPAN_EVENT_NAMES lives in `./otel-attrs` and is already surfaced via
// `packages/contracts/src/index.ts` (`export * from './otel-attrs'`). We do
// NOT re-export it here — that produced a duplicate-export warning when
// both modules were star-re-exported from the index barrel.
