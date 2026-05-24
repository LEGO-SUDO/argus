// @argus/contracts — shared TS/zod contracts.
//
// HLD D2 + D4 reference. Phase A surfaces authored here:
//   - otel-attrs.ts  OTel attribute schema (llm.*, conversation.*, user.*,
//                    message.*, turn.*) — consumed by projection consumer
//                    and emitted by packages/sdk.
//   - projection.ts  OTLP span schema + projection row shapes — the wire
//                    contract between consumer and Postgres.
//
// Backend-api LLD additions (authored before the WS gateway code):
//   - ws.ts            WS frame discriminated union (start | token | end |
//                      error | cancel-ack | send | cancel) + WS_PATH constant
//   - auth.ts          signup / login request schemas + AuthResponse
//   - conversations.ts conversation + message DTOs and CRUD request bodies
//   - errors.ts        stable ErrorResponseSchema for 4xx/5xx body shape
//
// Per brief cold-reader insight: contracts are authored BEFORE the WS
// Gateway is written.
export * from './otel-attrs';
export * from './projection';
export * from './ws';
export * from './auth';
export * from './conversations';
export * from './errors';
// Phase B (control plane) additions:
//   - live-events.ts   Kafka `live-events` payload + SSE tick + inference-kind enum
//   - console.ts       `/console/*` REST DTOs (Traces / Cost / Replay / Samples /
//                      Clear / live-badge / provider-availability) + CONSOLE_LIVE_PATH
export * from './live-events';
export * from './console';
