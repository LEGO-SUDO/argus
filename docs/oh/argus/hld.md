---
phase: hld
status: APPROVED
slug: argus
scope: phase-a
created: 2026-05-23
updated: 2026-05-23
---

# HLD: Argus — Phase A (Chatbot Foundation)

Phase A delivers the working chat surface, auth, multi-provider SDK, and the OTel-native ingestion path that lands inference data in Postgres. Phase B (the `/console`) is out of scope here but every persistence and event-shape decision below is taken with Phase B as the sole reader — so Phase B is a query layer, not a migration.

## Architecture Decisions

### D1: Outbox pattern — synchronous chat state, asynchronous telemetry
**Choice:** Two write paths with a clean ownership split, not one.
- **Chat state (source of truth, synchronous):** the WS Gateway writes `messages`, `conversations`, and a placeholder `inferences` row (`status=streaming`, null tokens) to Postgres via Prisma *before* the provider call begins. This guarantees read-after-write for reload/cancel/retry and means a dropped span never loses the user's message.
- **Telemetry (async enrichment):** the SDK emits OTel spans → OTLP/HTTP → OTel Collector → Redpanda `traces` topic → projection consumer, which *enriches* the existing `inferences` row by `message_id` and writes `trace_events`. The Collector exports OTLP independently to both Redpanda (for our consumer) and Jaeger (for the trace-detail UI).
- **Topic partitioning:** Redpanda topic is partitioned by `trace_id` (one chat turn = one root trace, so all spans for one `message_id` co-locate on the same partition, ordered). Implementation note: this matches the OTel Collector contrib Kafka exporter's `partition_traces_by_id` setting — verified during Phase 3b backend-infra LLD revision; arbitrary attribute-based partitioning is not supported by the exporter. Projection idempotency: `(trace_id, span_id)` unique constraint plus enrichment upsert on `message_id`.

**Rationale:** Both Phase 3a reviewers (Codex + Gemini) independently flagged that running chat state through a lossy-by-design telemetry pipeline is unsafe. The outbox split is the well-understood industry pattern: source of truth lives in Postgres; telemetry is a downstream observer. The "<5s end-to-end" claim still holds because the placeholder row is queryable immediately; enrichment fills in cost/spans within the staleness budget.
**Alternatives:** Single async OTel path (lossy, race-prone, reviewer-flagged); single synchronous path without event bus (loses the "event-based architecture" spec requirement and the Phase B replay-able-from-topic story).
**One-way door?** No — but the ownership split (gateway writes state, consumer enriches) becomes load-bearing once Phase B is reading.

### D2: WS frame envelope with server-assigned `message_id` (frame-typed)
**Choice:** A NestJS WS Gateway owns the connection. Every outbound frame carries a discriminated `type` (e.g. start, token, end, error, cancel-ack), a stable server-assigned `message_id` minted before the first provider call, a monotonically increasing `seq` per message, and provider identity on the start frame. Cancel is a client→server frame referencing `message_id`; the gateway aborts the provider stream, flushes any buffered partial content to `messages.content`, and emits a terminal `canceled` frame. On WS disconnect mid-stream, the same flush-then-abort sequence runs server-side so no real-provider tokens are billed without a persisted record.
**Rationale:** `message_id` + `seq` makes future mid-stream resume a non-breaking addition (PRD non-goal but contract-preserved). Discriminated types mean the web client's reducer is exhaustively checkable.
**Alternatives:** SSE (loses bidirectional cancel ergonomics; user-locked decision to use WS); raw token stream without envelope (blocks resume forever).
**One-way door?** **Yes — the `message_id` identity equality (WS frame == `messages.id` == `inferences.message_id`) is hard to unwind once persisted data exists.** The envelope shape is shared via `packages/contracts` and consumed by Phase B's Replay.

### D3: Provider router lives in `packages/sdk`, not in the API
**Choice:** The SDK exposes one `chat.stream(...)` surface. Inside, a router picks the active provider from a priority list, wraps the call in an OTel span, applies a per-provider circuit breaker (closed/open/half-open with a failure-rate window), and on pre-first-token failure transparently fails over to the next provider. Post-first-token failure terminates the turn (no stream stitching) and emits a failed span. The Mock provider is a first-class adapter seeded by `(conversationId, turnIndex)` for byte-identical replay.
**Rationale:** Putting routing in the SDK keeps the API thin and means the same instrumentation contract is used in tests, workers, and the gateway. Determinism in Mock is what makes Phase B's Replay meaningful on a keyless demo.
**Tradeoff note (for README):** Building a custom multi-provider SDK is a deliberate capability demonstration. A production deployment would wrap a hardened ecosystem SDK (Vercel AI SDK or LiteLLM) and inherit its provider-adapter test surface; the custom build here proves we understand the layer and lets us match instrumentation exactly to our `inferences`/`trace_events` schema. The prod swap is a one-package replacement behind the same `chat.stream(...)` interface — the router/circuit-breaker/instrumentation code stays.
**Alternatives:** Router in API (couples transport and provider logic; SDK loses its narrative); Vercel AI SDK / LiteLLM directly (sensible for prod; chosen against here for the senior-level capability signal).
**One-way door?** No.

### D4: Postgres schema designed for Phase B reads from day one
**Choice:** Five core tables plus one projection table, all in `packages/db` (Prisma).
- `users` — id, email, password_hash, created_at. Seeded demo user is idempotent via `ON CONFLICT (email)`.
- `sessions` — id, user_id, token_hash, expires_at. Server-side session (httpOnly cookie); no JWT.
- `conversations` — id, user_id, title, created_at, last_message_at. User-scoped queries always filter by user_id.
- `messages` — id (== `message_id` from WS), conversation_id, role (user|assistant|system), content, status (streaming|complete|canceled|failed), created_at, completed_at. Partial content is persisted on cancel/fail so the UI can reload it.
- `inferences` — id, message_id, conversation_id, user_id, provider, model, status, latency_ms, prompt_tokens, completion_tokens, prompt_cost_usd_micros, completion_cost_usd_micros, started_at, ended_at, input_preview, output_preview, trace_id, span_id, error_code. **Costs stored as integer micro-USD to avoid float drift; Phase B Cost tab sums these directly.** Failover attempts are separate rows linked by `message_id` so Phase B can show all attempts per turn.
- `trace_events` (projection table) — raw OTel span attributes the consumer lands here keyed by trace_id+span_id, with full input/output JSON blobs (not just previews) so Phase B Replay re-runs the exact original input. Indexed by `(user_id, created_at desc)` for the Traces feed. **Payload transport:** full I/O is emitted as OTel **span events** (not attributes — attributes get truncated by many Collector configurations), capped at 100KB per event with a truncation marker; Phase B treats truncated payloads as "non-replayable, see preview." Over-cap payloads as a stored-elsewhere sidecar (S3/MinIO) is "would do next."

**Rationale:** The split between `inferences` (cheap previews + denormalized rollup fields for Cost) and `trace_events` (raw payload for Replay/Trace-detail) means Phase B never JOINs against the bus and never re-derives token counts. The placeholder `inferences` row inserted by the gateway (D1) is enriched in place by the projection consumer keyed on `message_id` — never two rows for the same attempt.
**Alternatives:** One fat table (Replay blobs bloat Cost queries); ClickHouse for traces (overkill for small-scale, and Jaeger already gives reviewer the deep-dive UI).
**One-way door?** **Yes — column semantics (integer micro-USD, denormalized `user_id`, `(message_id)` identity) are load-bearing for Phase B.** Schema additions are cheap; column-semantic changes are not.

### D5: Auth = email/password + opaque session cookie, scoped at the gateway
**Choice:** Argon2id password hashing, opaque session token in an httpOnly+SameSite=Lax cookie, server-side `sessions` table. The WS Gateway validates the cookie at handshake and attaches `user_id` to the socket; every gateway message handler and every Prisma query filters by `user_id`. Seeded demo user is idempotent.
**Rationale:** Opaque sessions over JWT means logout is real (row delete), and the small-scale doesn't need stateless auth. Filtering at the gateway prevents the "wrong user reads someone else's conversation" class.
**Alternatives:** JWT (no real logout, no rotation story); NextAuth (drags an opinion stack the API would have to mirror).
**One-way door?** No.

### D6: Context window = last N turns capped at ~6k tokens, drop-oldest
**Choice:** A pure function in `packages/sdk` (`buildContext(messages, maxTokens)`) selects from the tail backward using a provider-agnostic token estimator (tiktoken-style heuristic; provider-exact counts come back from the response and are reconciled into `inferences`). Drop-oldest, no summarization. UI shows an "N earlier messages omitted" indicator when the estimator drops anything.
**Rationale:** Pure, deterministic, trivially TDD-able, and matches PRD's explicit "no summarization" call.
**One-way door?** No.

### D7: Compose topology — seven services, one network
**Choice:** `web` (Next.js), `api` (NestJS REST+WS), `workers` (NestJS Redpanda projection consumer), `postgres`, `redpanda`, `otel-collector`, `jaeger`. Healthchecks gate startup order; `api` waits for Postgres migrations to apply on boot. **Redis is dropped from Phase A compose** — it is unused (BullMQ jobs are Phase B); adding an idle required service expands the boot-failure surface without value. Redis returns to compose when Phase B introduces BullMQ-backed workers.
**Rationale:** Matches the brief's locked topology, minus the idle-Redis surface that Codex's §4.7 correctly flagged. `workers` exists in Phase A as the projection consumer only — Phase B adds BullMQ wiring and the `redis` service together as one coherent unit.

## Component Map

`apps/web` renders `/chat` (auth-gated) and `/login`+`/signup`. It opens one WS to `apps/api`'s Gateway and reduces frames into a per-conversation message log. `apps/api` exposes REST for auth + conversation CRUD and the WS Gateway for streaming; **the Gateway is the sole writer of `messages.status`** — it persists message rows synchronously (D1 outbox), calls into `packages/sdk`, and transitions status on stream-end / cancel / fail / disconnect. `packages/sdk` owns provider selection, per-provider circuit breaker (in-process for Phase A; Redis-backed when we scale — flagged as Open Question), OTel instrumentation, and Mock determinism. Spans flow via OTLP/HTTP to the Collector, which exports independently to Redpanda and to Jaeger. `apps/workers` consumes Redpanda and **enriches** the gateway-inserted `inferences` placeholder by `message_id` (writing tokens, cost, latency, span_id) and writes `trace_events` — it never touches `messages.status`. `packages/contracts` holds the WS envelope, OTel attribute schema, and projection row shapes — authored before the Gateway, per the brief's cold-reader insight.

## Test-Driven Development

### TDD-able surfaces (red→green pairing)
- `packages/sdk` provider router: priority selection, circuit-breaker state transitions, pre-first-token failover decision, post-first-token termination behavior.
- `packages/sdk` Mock provider: determinism (same `(conversationId, turnIndex)` ⇒ identical token sequence and timing buckets).
- `packages/sdk` context builder: drop-oldest under token cap, indicator-trigger boundary, empty-history case.
- `packages/sdk` token-cost calculator: micro-USD math, missing-pricing-entry → zero (PRD requires this for Phase B's "—" cell).
- `apps/api` auth service: password hash/verify, session issuance + revocation, idempotent demo-user seed.
- `apps/api` WS frame builder: envelope shape per type, `seq` monotonicity, server-side `message_id` minting uniqueness.
- `apps/api` authorization filter: every Prisma access path rejects cross-user reads (table-driven test).
- `apps/workers` projection consumer: OTLP span → `inferences` row mapping (including failover-attempt linkage), idempotency on duplicate spans (trace_id+span_id unique).
- `packages/contracts` zod schemas: round-trip validation for every WS frame type and every OTel attribute payload.

### Non-TDD-able surfaces
- `/chat` UI streaming reducer in the browser — manual click-through across send, mid-stream cancel, fail-and-retry, refresh-during-stream; component-level snapshot for the message list states.
- WS handshake + cookie auth across services — local compose smoke: login → open WS → receive `start` frame within 500ms.
- OTel Collector + Redpanda + Jaeger wiring — compose-up healthcheck plus an end-to-end smoke that asserts a single chat turn produces exactly one `inferences` row and one Jaeger trace.
- Real-provider adapters (OpenAI/Anthropic/Gemini) network behavior — contract tests against recorded fixtures; live calls left to manual demo runs.
- Prisma migrations — applied on `api` boot; smoke is `compose up` on an empty volume succeeding.

## Observability

Self-hosted OTel-native pipeline is the differentiator and the only telemetry: SDK (OTel SDK + custom `llm.*` attributes) → OTLP/HTTP → OTel Collector → Redpanda `traces` topic → `apps/workers` projection consumer → Postgres (`inferences` + `trace_events`); Jaeger consumes the same topic for the trace-detail UI linked from Phase B's Traces tab.

## Regression Risk Surface

- **Backend:** WS Gateway cookie auth must not regress to permitting anonymous sockets; cross-user query filter is a single point of failure (add the table-driven test in Phase A so Phase B's `/console` inherits it).
- **Shared contracts:** any change to the WS envelope or OTel attribute schema breaks both web reducer and projection consumer — `packages/contracts` is the gate.
- **Ingestion:** projection consumer must be idempotent; duplicate OTLP delivery is normal under Collector retries.
- **Frontend-web:** stream cancel must transition message state to `canceled` exactly once even if a late token frame races the cancel-ack.
- **Compose:** boot-order regressions (api starting before postgres ready) silently break the demo; healthcheck gates are load-bearing.

## Forward-Compatibility Locks (Phase B will depend on these)

- `inferences.prompt_cost_usd_micros` + `completion_cost_usd_micros` integer columns — Cost tab sums these, no float ever.
- `trace_events` carries full input/output JSON (not previews) — Replay re-runs the exact original input.
- Every failover attempt is its own `inferences` row keyed by `message_id` — Traces shows all attempts per turn.
- WS `message_id` == `messages.id` == `inferences.message_id` — single identifier across UI, DB, and trace spans; Replay link from Traces is a direct lookup.
- OTel attributes include `llm.provider`, `llm.model`, `llm.prompt_tokens`, `llm.completion_tokens`, `llm.status`, `conversation.id`, `user.id`, `message.id`, `turn.index` — Phase B Cost/Traces/Replay all read from these without re-derivation.
- `user_id` is denormalized onto `inferences` and `trace_events` — Phase B's per-user scoping is a single WHERE, no JOIN.
- Mock determinism keyed by `(conversationId, turnIndex)` — Replay-against-Mock produces a meaningful diff baseline.

## File-Change Inventory

- `apps/web/app/(auth)/login/page.tsx` — login form, inline error states.
- `apps/web/app/(auth)/signup/page.tsx` — signup form, duplicate-email error.
- `apps/web/app/chat/page.tsx` — auth-gated chat shell.
- `apps/web/app/chat/[conversationId]/page.tsx` — resume view with history reload.
- `apps/web/components/chat/MessageStream.tsx` — WS reducer + cancel/retry controls.
- `apps/web/components/chat/ConversationList.tsx` — user-scoped list.
- `apps/web/lib/ws-client.ts` — typed WS client using `packages/contracts`.
- `apps/api/src/auth/*` — auth module (signup, login, logout, session guard, demo seed).
- `apps/api/src/conversations/*` — REST CRUD, user-scoped repository.
- `apps/api/src/chat/chat.gateway.ts` — WS Gateway, cookie auth on handshake, frame envelope, cancel handler.
- `apps/api/src/chat/chat.service.ts` — orchestrates SDK call, persists message rows, owns `message_id` minting.
- `apps/api/src/bootstrap/seed.ts` — idempotent demo-user seed on boot.
- `apps/workers/src/projection/*` — Redpanda consumer, OTLP-span-to-`inferences` mapper, idempotency guard.
- `packages/sdk/src/router.ts` — provider selection + failover + circuit breaker.
- `packages/sdk/src/providers/{openai,anthropic,gemini,mock}.ts` — adapters.
- `packages/sdk/src/context.ts` — token-aware context builder (pure).
- `packages/sdk/src/cost.ts` — token→micro-USD calculator + pricing snapshot.
- `packages/sdk/src/otel.ts` — span helpers, attribute constants.
- `packages/db/prisma/schema.prisma` — five core tables + `trace_events`.
- `packages/db/prisma/migrations/0001_init/*` — initial migration.
- `packages/contracts/src/ws.ts` — WS frame discriminated union (zod).
- `packages/contracts/src/otel-attrs.ts` — OTel attribute schema.
- `packages/contracts/src/projection.ts` — `inferences` + `trace_events` row shapes.
- `infra/compose/docker-compose.yml` — seven services + healthchecks (no Redis in Phase A).
- `infra/otel/collector.yaml` — OTLP receiver → Kafka exporter (Redpanda) + Jaeger exporter.
- `infra/redpanda/topics.sh` — create `traces` topic on first boot.
- `.env.example` — `MOCK_PROVIDER=true` default, provider key slots, session secret.

## Open Questions

- **Circuit-breaker state location.** In-process per `api` instance (simple, but resets on restart and doesn't share across replicas) vs. Redis-backed shared state (matches a "real" deploy, more moving parts for a small-scale). *Absent override I would default to in-process for Phase A and note the Redis upgrade path in the README — Phase A is single-replica via compose anyway.*
- **Provider-token-count normalization.** Providers report tokens with different definitions (cached prompts, tool calls, etc.). Strict per-provider passthrough vs. a normalized "billable tokens" view. *Absent override I would store per-provider raw counts plus a normalized field, both fed by adapter code, so Phase B's Cost tab can choose its lens without a migration.*
- **Pricing snapshot location.** Static TS map in `packages/sdk/src/cost.ts` vs. a `pricing` Postgres table seeded on boot. *Absent override I would ship the static map for Phase A (reviewer-readable, diffable, no migration), and flag the table swap as "would do next" when pricing needs hot-reload.*
- **Output-preview length.** PRD says "input/output previews" but doesn't fix a length. *Absent override I would cap previews at 500 chars in `inferences` and keep full content in `trace_events` — Phase B Traces row stays small, Replay still works.*
- **Refresh-during-stream server cleanup.** PRD makes the user-visible behavior clear (partial response marked interrupted, retry button) but doesn't specify whether the server keeps streaming from the provider after WS disconnect. *Absent override I would abort the provider call on WS disconnect to avoid silently burning real-provider tokens, and persist whatever streamed so far as `status=failed` with a distinct `error_code=client_disconnected` — keeps `inferences` rows honest for Phase B Cost.*

## Reviewer Concerns (acknowledged, deferred to LLD / README runbook)

From Codex + Gemini HLD review:

- **Operational failure-mode catalog** (Collector down, Redpanda down, Worker down, Postgres down, OTLP payload over limit, session expires mid-WS, multi-tab streaming same conversation, migration race in multi-replica). Categories named in Regression Risk Surface; exhaustive enumeration is explicitly disallowed by HLD template, so individual smoke tests go in Phase 3b LLD and operator-facing fallback behavior goes in the README runbook section.
- **Token-accounting nullable semantics** for providers that report inconsistently. Already flagged in PRD Reviewer Concerns and brief Open Questions; resolved in Phase 3b LLD when the projection-consumer test contract is written.
- **Circuit breaker shared-state for multi-replica deploys.** Already in Open Questions above; Phase A is single-replica, README documents the Redis upgrade path.
- **OTel as schema commitment.** Codex flagged this as a soft one-way door not explicitly tagged; we accept this — OTel attribute names are versioned in `packages/contracts` and any breaking change cascades through the contracts package as designed.
