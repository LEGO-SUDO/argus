# Architecture

Argus is two systems welded together: a streaming chatbot product (consumer
surface at `/chat`) and an observability spine for every model call (operator
surface at `/console` — Phase B). This document covers the Phase A foundation
and the forward-compatibility decisions that let Phase B add the console
without a schema migration.

---

## System overview

```
chatbot (/chat)  ─►  WS Gateway (NestJS)  ─►  Provider Router (SDK)
                            │                          │
                            │ Prisma (sync)            │ OTel spans (async)
                            ▼                          ▼
                       Postgres                   OTel Collector
                  (chat state — source            │
                   of truth + outbox)             ├─► Redpanda `traces` topic
                                                  │       │
                                                  │       ▼
                                                  │   Projection consumer
                                                  │   (NestJS workers)
                                                  │       │
                                                  │       ▼
                                                  │   Postgres
                                                  │   (inferences + trace_events
                                                  │    — enriched async by message_id)
                                                  │
                                                  └─► Jaeger (trace-detail UI)
```

---

## Decision 1 — Outbox pattern: chat state synchronous, telemetry async

**Choice.** Two write paths with a clean ownership split:

- **Chat state (source of truth, synchronous):** the WebSocket Gateway writes
  `messages`, `conversations`, and a placeholder `inferences` row
  (`status=streaming`, null tokens) to Postgres via Prisma *before* the
  provider call begins. This guarantees read-after-write for reload / cancel /
  retry and means a dropped span never loses the user's message.
- **Telemetry (asynchronous enrichment):** the SDK emits OpenTelemetry spans
  → OTLP/HTTP → OTel Collector → Redpanda `traces` topic → projection
  consumer, which *enriches* the existing `inferences` row by `message_id`
  and writes `trace_events`. The Collector exports OTLP independently to
  both Redpanda (for the projection consumer) and Jaeger (for the trace-
  detail UI).

**Why.** Running chat state through a lossy-by-design telemetry pipeline is
unsafe: OTel collectors are commonly configured to drop spans under
backpressure or sampling, and a dropped span would mean a permanently lost
user message. The outbox split is the well-understood industry pattern: the
source of truth lives in Postgres; telemetry is a downstream observer.

**Trade-off.** Two write paths instead of one. The mitigating discipline:
the Gateway is the **sole writer** of `messages.status` and the placeholder
`inferences` row; the projection consumer is the **sole writer** of
trace-derived fields (tokens, cost, latency, trace_id, span_id) and
`trace_events`. A grep-based unit test fails the build if `projection.service.ts`
ever references the `messages` Prisma delegate.

**Topic partitioning.** Redpanda topic is partitioned by `trace_id` (one chat
turn = one root trace, so all spans for one `message_id` co-locate on the
same partition, ordered). Projection idempotency: `(trace_id, span_id)`
unique constraint on `trace_events`; insert that row first inside a tiny
transaction — `P2002` conflict means duplicate delivery, skip; otherwise
update the inference row.

---

## Decision 2 — WebSocket frame envelope with server-assigned `message_id`

The Gateway owns the WS connection. Every outbound frame carries:
- a discriminated `type` (`start`, `token`, `end`, `error`, `cancel-ack`)
- a stable server-assigned `message_id` minted **before** the first provider
  call (no sentinel UUIDs on error paths — every frame is correlatable)
- a monotonic `seq` per message (forward-compat for future mid-stream resume)
- provider identity on the `start` frame

Cancel is a client→server frame referencing `message_id`. The Gateway aborts
the provider stream, flushes any buffered partial content to
`messages.content`, and emits a terminal `canceled` frame. On WS disconnect
mid-stream, the same flush-then-abort sequence runs server-side so no
real-provider tokens are billed without a persisted record.

`message_id` equality across UI / DB / trace spans is a hard schema
commitment — locked once data exists.

---

## Decision 3 — Provider router in the SDK, not the API

The SDK exposes one `chat.stream(...)` surface. Inside:
- A router picks the active provider from a priority list
- Each call is wrapped in an OTel span with `llm.*` attributes
- Per-provider circuit breaker (closed / open / half-open with a failure-rate
  window). On pre-first-token failure, fail over to the next provider. On
  post-first-token failure, terminate the turn (no stream stitching across
  providers) and emit a failed span.
- The Mock provider is a first-class adapter, deterministic by
  `(conversationId, turnIndex)` so the same input always produces the same
  streamed output — keyless development works end-to-end.

Putting routing in the SDK keeps the API thin and means the same
instrumentation contract is used in tests, workers, and the Gateway.

---

## Decision 4 — Postgres schema designed for the operator console from day one

Six tables in `packages/db/prisma/schema.prisma`:

- **`users`** — id, email, password_hash, created_at. Demo user idempotently seeded.
- **`sessions`** — id, user_id, token_hash, expires_at. Server-side opaque session (httpOnly cookie); not JWT. Sliding-window refresh on lookup hit.
- **`conversations`** — id, user_id, title, created_at, last_message_at. User-scoped queries always filter by user_id.
- **`messages`** — id (== `message_id` from WS), conversation_id, role (user|assistant|system), content, status (streaming|complete|canceled|failed), created_at, completed_at, error_code. Partial content persists on cancel/fail so the UI can reload it.
- **`inferences`** — id, message_id, conversation_id, user_id, provider, model, status, latency_ms, prompt_tokens, completion_tokens, prompt_cost_usd_micros, completion_cost_usd_micros, started_at, ended_at, input_preview, output_preview, trace_id, span_id, error_code. **Costs stored as integer micro-USD** to avoid float drift. Failover attempts are separate rows linked by `message_id`.
- **`trace_events`** (projection table) — raw OTel span attributes the consumer lands here keyed by trace_id+span_id, with full input/output JSON blobs (not just previews) so the operator console can re-run the exact original input as a replay. Indexed by `(user_id, created_at desc)`.

**Forward-compatibility decisions locked here** (the operator console will
read these without a migration):

- Costs as integer micro-USD — Cost dashboards sum these directly. No float.
- `trace_events.payload` carries full I/O — Replay re-runs the exact input.
- Every failover attempt is its own `inferences` row keyed by `message_id` — Traces view shows all attempts per turn.
- WS `message_id` == `messages.id` == `inferences.message_id` — single identifier across UI, DB, trace spans. Traces→Replay link is a direct row lookup.
- `user_id` denormalized onto `inferences` and `trace_events` — per-user scoping is a single WHERE clause, no JOIN.
- Mock determinism keyed by `(conversationId, turnIndex)` — Replay-against-Mock produces a meaningful diff baseline.

---

## Decision 5 — Auth: email/password + opaque session cookie

Argon2id password hashing. Cryptographically random 32-byte session token
hashed with HMAC-SHA256 (keyed by `SESSION_SECRET`) for deterministic lookup.
Cookie: `httpOnly` + `SameSite=Lax`, `secure` from env. Server-side
`sessions` table — logout is a real row delete (not a token rotation
problem). The WS Gateway validates the cookie at handshake and attaches
`user_id` to the socket; every Gateway message handler and every Prisma
query filters by `user_id`.

A table-driven authorization test fails the build if a new repository
method is added without explicit user-scoping.

---

## Decision 6 — Context window: last N turns, drop-oldest, no summarization

A pure function in `packages/sdk` selects from the message tail backward
using a provider-agnostic token estimator. Drop oldest when over budget
(`CONTEXT_MAX_TOKENS`, default 6000). No summarization — keeps the
implementation deterministic and trivially TDD-able. The UI surfaces an
"N earlier messages omitted from context" indicator when the estimator
drops anything.

---

## Decision 7 — Compose topology: seven services, healthcheck-gated

`web` (Next.js) · `api` (NestJS REST+WS) · `workers` (NestJS Redpanda
consumer) · `postgres` · `redpanda` · `redpanda-bootstrap` (one-shot topic
creation) · `otel-collector` · `jaeger`.

Healthchecks gate startup order. `api` runs `prisma migrate deploy` before
the Nest bootstrap so migrations are applied automatically. The
`SESSION_SECRET` env var uses fail-fast `${VAR:?}` syntax — Compose refuses
to render the api service without an explicit secret.

Redis is intentionally absent in Phase A. The operator console's BullMQ
workers (cost rollup, replay engine) introduce Redis when they land.

---

## Component map

`apps/web` renders `/chat` (auth-gated) and `/login` + `/signup`. It opens
one WS to `apps/api`'s Gateway and reduces frames into a per-conversation
message log. `apps/api` exposes REST for auth + conversation CRUD and the WS
Gateway for streaming. The Gateway is the sole writer of `messages.status`,
persists message rows synchronously, calls into `packages/sdk`, and
transitions status on stream-end / cancel / fail / disconnect.
`packages/sdk` owns provider selection, per-provider circuit breaker, OTel
instrumentation, and Mock determinism. Spans flow via OTLP/HTTP to the
Collector, which exports independently to Redpanda and to Jaeger.
`apps/workers` consumes Redpanda and enriches the Gateway-inserted
`inferences` placeholder by `message_id` — it never touches `messages.status`.
`packages/contracts` holds the WS envelope, OTel attribute schema, and
projection row shapes — authored before the Gateway so both ends compile
against the same source of truth.

---

## Test partitioning

**TDD-able surfaces** (red→green pairs):
- Provider router: priority selection, circuit-breaker state transitions, pre-first-token failover, post-first-token termination
- Mock provider: determinism (same `(conversationId, turnIndex)` ⇒ identical tokens)
- Context builder: drop-oldest under token cap, omitted-count indicator boundary
- Token-cost calculator: micro-USD math, missing-pricing-entry handling
- Auth service: password hash/verify, session issuance + revocation, idempotent demo seed
- WS frame builder: envelope shape per type, `seq` monotonicity, `message_id` uniqueness
- Authorization filter: table-driven test rejecting cross-user reads
- Projection consumer: OTLP span → `inferences` mapping, failover-attempt linkage, idempotency on duplicate spans
- Contracts zod schemas: round-trip validation for every WS frame type

**Non-TDD-able surfaces** (smoke-test acceptance):
- `/chat` UI streaming reducer — manual click-through; component snapshots
- WS handshake + cookie auth — local compose smoke: login → open WS → receive `start` frame
- OTel Collector + Redpanda + Jaeger wiring — compose-up healthcheck plus end-to-end smoke (one chat turn → one `inferences` row + one Jaeger trace)
- Real-provider adapters — contract tests against recorded fixtures; live calls left to manual demo runs
- Prisma migrations — applied on `api` boot; smoke is `compose up` on an empty volume succeeding

End-to-end (Playwright) covers the golden path: signup / login / logout,
send / stream / cancel / retry, conversation list, resume via direct URL.

---

## Phase B roadmap (forward-compat, not implemented)

- **Operator `/console`** with three lenses on the same event spine:
  - **Traces** — near-real-time feed of inference rows; deep link to Jaeger
  - **Cost** — aggregated spend by provider / model / conversation; budget alerts
  - **Replay** — pick a past inference; re-run against any available provider; side-by-side diff with cost/latency deltas
- **Evals** — golden-dataset runner; LLM-as-judge scoring; drift charts per (model × prompt-version)
- **True mid-stream resume** — reconnect to in-flight stream with sequenced-delta replay. The `message_id`-in-envelope contract already preserves the protocol space.
- **PII redaction** — SDK-side pre-write scrub; configurable patterns
- **Hosted deployment** — self-hosted k8s manifests

---

## Tradeoffs documented in code

- **OTLP wire encoding is JSON, not protobuf.** Collector exports as
  `otlp_json` for simplicity and so the projection consumer can use
  `JSON.parse` directly. Protobuf would be 30-50% smaller on the wire; the
  swap is one Collector config line plus a request-deserializer call in the
  consumer. Deferred.

- **Failover detection runs in the projection consumer, not the SDK.** The
  SDK emits one span per attempt; the consumer's `failover-detector` infers
  attempt-vs-enrichment from `(message_id, provider, status)`. A purer design
  would have the SDK attach an explicit `llm.attempt_index` attribute.

- **No FK from `inferences.message_id → messages.id`.** Under retry, the
  projection consumer can land a span before the Gateway finishes the
  placeholder insert. We'd rather enrich-eventually than reject. Readers
  must handle orphan `inferences` rows (rare; possible during Gateway
  restart).

- **Per-workspace `node_modules` copied in runner Dockerfiles.** pnpm
  installs workspace deps as symlinks; copying only root `node_modules`
  loses them. A deeper fix would rework tsconfig paths so packages resolve
  via node_modules symlinks instead of explicit path aliases that pull
  source into the compilation root.

- **`router.replace` over `window.history.replaceState` for the URL swap on
  the first `start` frame.** Works because `MessageStream` is hoisted into
  the chat layout — Next's route reconciliation no longer remounts the WS-
  connected component. The history-replaceState workaround that previous
  builds used is documented and removed.
