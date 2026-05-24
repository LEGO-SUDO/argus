// live-events — the Kafka `live-events` topic payload + the SSE tick the API
// fans out to `/console/live` subscribers.
//
// Flow (HLD Phase B): the workers projection consumer publishes ONE snake_case
// record to the `live-events` topic AFTER the Postgres commit of a chat /
// replay / sample turn succeeds (publish-after-commit, key = user_id). The API
// `live-events` consumer (group `api-live-fanout`) decodes it and calls
// `SseHub.publish(user_id, tick)`, which broadcasts to that user's open SSE
// streams so the console refetches.
//
// All wire fields are snake_case to match the OTel attribute / DB column
// naming convention (CONTRACTS.md §Naming). INFRA's contracts test asserts the
// snake_case shape of `LiveEventsPayload`.
import { z } from 'zod';
import { OtelLlmKindAttributeSchema } from './otel-attrs';

// The inference-kind enum, re-homed under the live-events name the console /
// SSE layer imports. Single source of truth lives in otel-attrs.
export const LiveEventKindEnum = OtelLlmKindAttributeSchema;
export type InferenceKind = z.infer<typeof LiveEventKindEnum>;

// ---------------------------------------------------------------------------
// SSE event delivered to the browser (discriminated union on `type`).
// Currently only the `tick` variant exists; the union leaves room for future
// server-pushed event kinds without breaking the client's switch.
// ---------------------------------------------------------------------------

export const LiveTickEventSchema = z.object({
  type: z.literal('tick'),
  user_id: z.string().uuid(),
  kind: LiveEventKindEnum,
  conversation_id: z.string().uuid(),
});
export type LiveTickEvent = z.infer<typeof LiveTickEventSchema>;

export const LiveEventSchema = z.discriminatedUnion('type', [LiveTickEventSchema]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

// ---------------------------------------------------------------------------
// Kafka `live-events` message value — the snake_case payload INFRA publishes
// and the API consumer parses. No `type` discriminator on the wire; the API
// wraps it into a `tick` LiveEvent before fan-out.
// ---------------------------------------------------------------------------

export const LiveEventsPayload = z.object({
  user_id: z.string().uuid(),
  kind: LiveEventKindEnum,
  conversation_id: z.string().uuid(),
});
export type LiveEventsPayloadValue = z.infer<typeof LiveEventsPayload>;

// Aliases for the names the backend-api LLD references — same schemas, kept so
// apps/api compiles against either spelling. Extra exports are harmless to the
// other panes (they build to the CONTRACTS.md names above).
export const LiveEventPayloadSchema = LiveEventsPayload;
export const SseTickSchema = LiveTickEventSchema;
export type SseTick = LiveTickEvent;
