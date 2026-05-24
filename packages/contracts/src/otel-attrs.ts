// OTel attribute schema — names that flow from SDK spans into the projection
// consumer and the operator console. Versioned here so any breaking change
// cascades through the contracts package (OTel attribute names are a durable
// schema commitment).

import { z } from 'zod';

// Canonical attribute keys. Use these constants when reading from / writing to
// OTel spans so we never typo a name across the boundary.
export const OTEL_ATTRS = {
  LLM_PROVIDER: 'llm.provider',
  LLM_MODEL: 'llm.model',
  LLM_PROMPT_TOKENS: 'llm.prompt_tokens',
  LLM_COMPLETION_TOKENS: 'llm.completion_tokens',
  LLM_STATUS: 'llm.status',
  LLM_ERROR_CODE: 'llm.error_code',
  // Cost columns are computed in the SDK (cost calculator runs there per HLD
  // D3) and attached to the span so the projection consumer never re-derives
  // pricing. Integer micro-USD to avoid float drift.
  LLM_PROMPT_COST_USD_MICROS: 'llm.prompt_cost_usd_micros',
  LLM_COMPLETION_COST_USD_MICROS: 'llm.completion_cost_usd_micros',
  LLM_INPUT_PREVIEW: 'llm.input_preview',
  LLM_OUTPUT_PREVIEW: 'llm.output_preview',
  CONVERSATION_ID: 'conversation.id',
  USER_ID: 'user.id',
  MESSAGE_ID: 'message.id',
  TURN_INDEX: 'turn.index',
} as const;

export const SPAN_EVENT_NAMES = {
  LLM_INPUT: 'llm.input',
  LLM_OUTPUT: 'llm.output',
} as const;

// Status values the projection consumer cares about. Free-text in the database
// (see lld-backend-infra Open Question #2) but enumerated here to make adapter
// drift visible at compile time.
export const LlmStatusSchema = z.enum(['ok', 'streaming', 'failed', 'canceled']);
export type LlmStatus = z.infer<typeof LlmStatusSchema>;

// The subset of OTLP span attributes our projection consumer reads. Extra
// attributes are allowed and ignored — zod's default object behavior.
export const OtelAttributesSchema = z.object({
  [OTEL_ATTRS.LLM_PROVIDER]: z.string(),
  [OTEL_ATTRS.LLM_MODEL]: z.string(),
  [OTEL_ATTRS.LLM_PROMPT_TOKENS]: z.number().int().nonnegative().optional(),
  [OTEL_ATTRS.LLM_COMPLETION_TOKENS]: z.number().int().nonnegative().optional(),
  [OTEL_ATTRS.LLM_STATUS]: LlmStatusSchema,
  [OTEL_ATTRS.LLM_ERROR_CODE]: z.string().optional(),
  [OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS]: z.number().int().nonnegative().optional(),
  [OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS]: z.number().int().nonnegative().optional(),
  [OTEL_ATTRS.LLM_INPUT_PREVIEW]: z.string().max(500).optional(),
  [OTEL_ATTRS.LLM_OUTPUT_PREVIEW]: z.string().max(500).optional(),
  [OTEL_ATTRS.CONVERSATION_ID]: z.string().uuid(),
  [OTEL_ATTRS.USER_ID]: z.string().uuid(),
  [OTEL_ATTRS.MESSAGE_ID]: z.string().uuid(),
  [OTEL_ATTRS.TURN_INDEX]: z.number().int().nonnegative(),
});
export type OtelAttributes = z.infer<typeof OtelAttributesSchema>;
