# Architecture

Argus is two systems welded together on one event spine: a streaming chatbot
product (consumer surface at `/chat`) and an observability control plane for
every model call (operator surface at `/console`). Both phases are implemented
and deployed — web on Vercel, the API + workers + data plane on DigitalOcean
Kubernetes (DOKS), Postgres on Neon. This document covers the design and the
forward-compatibility decisions that let the console read the chat event spine
without a schema fork.

> **Live demo:** https://argus-web-tau.vercel.app/ — log in as
> `demo@argus.dev` / `let-me-in-9`. The deployment boots against the
> deterministic mock provider, so the full chat → trace → console pipeline is
> exercisable with zero LLM spend.

---

## System overview

```
            Vercel (web)                              Neon (Postgres, managed)
        /chat        /console                                  ▲
          │             │                                      │
   browser WSS      REST /api/* (proxied)                      │ source of truth
          │             │                                      │   + projection
          ▼             ▼                                      │
   ┌──────────────── DOKS (namespace: argus) ──────────────────┼──────────────┐
   │                                                            │              │
   │  api (NestJS REST + WS Gateway) ───────────────────────────┤              │
   │     │  ├─ auth / conversations CRUD                        │              │
   │     │  ├─ chat WS Gateway  ──► SDK provider router ──┐      │              │
   │     │  ├─ auto router (classifier → provider)        │      │              │
   │     │  ├─ console (Traces / Cost / Replay)           │ OTel │              │
   │     │  ├─ replay engine                              │ spans│              │
   │     │  └─ live SSE  ◄── live-events consumer         ▼      │              │
   │     │         ▲                              OTel Collector │              │
   │     │         │ live-events topic                   │      │              │
   │  workers (projection consumer) ◄── traces topic ◄───┤      │              │
   │     └─ enriches inferences by message_id,           └──► Jaeger (UI)      │
   │        publishes live-events after DB commit                              │
   │                                                                           │
   │  Redpanda (StatefulSet): topics `traces` + `live-events`                  │
   │  ingress-nginx + cert-manager → https://api-argus.duckdns.org             │
   └───────────────────────────────────────────────────────────────────────────┘
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
  consumer (`apps/workers`), which *enriches* the existing `inferences` row by
  `message_id` and writes `trace_events`. The Collector exports OTLP
  independently to both Redpanda (for the projection consumer) and Jaeger (for
  the trace-detail UI).

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

**Topic partitioning.** Redpanda `traces` topic is partitioned by `trace_id`
(one chat turn = one root trace, so all spans for one `message_id` co-locate on
the same partition, ordered). Projection idempotency: a `(trace_id, span_id,
name)` unique constraint on `trace_events` — insert that row first inside a
tiny transaction; a `P2002` conflict means duplicate delivery, skip; otherwise
update the inference row.

---

## Decision 2 — WebSocket frame envelope with server-assigned `message_id`

The Gateway owns the WS connection (`/ws/chat`). Every outbound frame carries:
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

## Decision 3 — Provider router in the SDK, auto-routing in the API

The SDK (`packages/sdk`) exposes one `chat.stream(...)` surface. Inside:
- A router picks the active provider from a priority list (`PROVIDER_ORDER`)
- A request may **pin** a specific `(provider, model)` to bypass the priority
  head — used by Replay, the Auto classifier, and the per-conversation model
  picker. The router only targets a specific adapter via `req.pin`; the bare
  `provider`/`model` hint fields are not honored on their own.
- Each call is wrapped in an OTel span with `llm.*` attributes
- Per-provider circuit breaker (closed / open / half-open with a failure-rate
  window). On pre-first-token failure, fail over to the next provider. On
  post-first-token failure, terminate the turn (no stream stitching across
  providers) and emit a failed span.
- The Mock provider is a first-class adapter, deterministic by
  `(conversationId, turnIndex)`, so the same input always produces the same
  streamed output — keyless development works end-to-end.

**Auto routing** lives one level up, in `apps/api/src/auto` (it composes the
SDK rather than living inside it, because it persists its own inference row).
When the user selects the **Auto** provider:
- **OpenAI key present** → an LLM classifier (`gpt-4o-mini`, pinned) reads the
  message and returns one of `coding` / `research` / `general`. It persists a
  `kind='classifier'` inference row linked to the triggering user message. The
  category maps to a provider: `coding → anthropic`, `research → gemini`,
  `general → openai`.
- **Keyless** → an in-process keyword heuristic returns the same category
  union (no row written).
- **Classifier failure is *not* provider failover** — it always degrades to the
  keyword heuristic. (Captured to Sentry; the turn still routes.)

Putting the streaming router in the SDK keeps the same instrumentation contract
across tests, workers, the Gateway, and the Replay engine.

---

## Decision 4 — Postgres schema designed for the operator console from day one

Eight models in `packages/db/prisma/schema.prisma` — six core chat tables and
two Phase B operator tables. The console reads the chat event spine with no
fork.

**Core (Phase A):**

- **`users`** — id, email, password_hash, created_at. Demo user idempotently seeded.
- **`sessions`** — id, user_id, token_hash, expires_at, `current_sample_workspace_id`. Server-side opaque session (httpOnly cookie); not JWT. Sliding-window refresh on lookup hit.
- **`conversations`** — id, user_id, title, created_at, last_message_at, plus `pinned_provider` / `pinned_model` for the per-conversation model picker (they move together by contract).
- **`messages`** — id (== `message_id` from WS), conversation_id, role, content, status (streaming|complete|canceled|failed), created_at, completed_at. Partial content persists on cancel/fail so the UI can reload it.
- **`inferences`** — one row per provider attempt, keyed by `message_id`. Carries provider, model, status, `kind`, latency, token counts, **costs as integer micro-USD** (no float drift), previews, trace_id, span_id, error_code, `updated_at`, and the Phase B FK columns `classifier_for_message_id` / `replay_of_inference_id` / `sample_workspace_id`.
- **`trace_events`** (projection table) — raw OTel span events keyed by `(trace_id, span_id, name)`, with full input/output JSON blobs (capped at 100 KB) and a denormalized `kind`. Indexed by `(user_id, created_at desc)`.

**Phase B tables:**

- **`sample_workspaces`** — one per Generate-Samples run; owns synthetic demo inferences so they can be scoped/cleared independently of real chat. Cascades on user delete.
- **`user_clear_fences`** — one row per user (`clear_after_ts`); the Clear-history fence the projection consumer reads to drop stale spans (see Decision 9).

**`InferenceKind`** enum classifies every inference and trace event:
`chat` (default) · `classifier` · `replay` · `sample` · `heartbeat` ·
`unknown` (reserved *only* for OTel values the consumer doesn't recognize).

**Forward-compatibility decisions locked here:**

- Costs as integer micro-USD — the Cost lens sums these directly. No float.
- `trace_events.payload` carries full I/O — Replay re-runs the exact input.
- Every failover attempt is its own `inferences` row keyed by `message_id`.
- WS `message_id` == `messages.id` == `inferences.message_id` — single identifier across UI, DB, trace spans. Traces→Replay is a direct row lookup.
- `user_id` denormalized onto `inferences` and `trace_events` — per-user scoping is a single WHERE clause, no JOIN.
- Mock determinism keyed by `(conversationId, turnIndex)` — Replay-against-Mock produces a meaningful diff baseline.

---

## Decision 5 — Auth: email/password + opaque session, cookie *or* WS ticket

Argon2id password hashing. Cryptographically random 32-byte session token
hashed with HMAC-SHA256 (keyed by `SESSION_SECRET`) for deterministic lookup.
Cookie: `httpOnly` + `SameSite=Lax`, `secure` from env. Server-side `sessions`
table — logout is a real row delete (not a token rotation problem).

The WS Gateway resolves the user at handshake **two ways, in order**:
1. **`?token=` on the handshake URL** — for cross-origin browsers (the Vercel
   web app is on a different domain than the API, so it cannot send the session
   cookie over the WS handshake). The client fetches a short-lived ticket from
   `GET /auth/ws-ticket` and passes it on the socket URL.
2. **Session cookie** — same-origin and local dev.

Either path attaches `user_id` to the socket; every Gateway message handler and
every Prisma query filters by `user_id`. A table-driven authorization test
fails the build if a new repository method is added without explicit
user-scoping.

---

## Decision 6 — Context window: last N turns, drop-oldest, no summarization

A pure function in `packages/sdk` selects from the message tail backward using
a provider-agnostic token estimator. Drop oldest when over budget
(`CONTEXT_MAX_TOKENS`, default 6000). No summarization — keeps the
implementation deterministic and trivially TDD-able. The UI surfaces an "N
earlier messages omitted from context" indicator (the `ContextMeter`) when the
estimator drops anything.

---

## Decision 7 — Console: three lenses on the same event spine

`/console` is the operator surface (`apps/web/app/console`), backed by
`apps/api/src/console`. All routes are `SessionGuard`-protected and read
`user_id` off the request. Three lenses, all reading the chat event spine:

- **Traces** — near-real-time feed of `inferences` rows with provider/model/
  status/cost/latency, faceted filters (provider, model, status, conversation,
  free-text), a throughput strip, a per-turn failover chain, and a span drawer.
  `GET /console/traces`.
- **Cost** — spend aggregated by provider / model / conversation, with a
  sparkline, unpriced-model flagging, and toggles to include/exclude replay,
  mock, and sample rows. `GET /console/cost`.
- **Replay** — pick a past inference, re-run it against any available provider/
  model, and diff the result. `GET /console/replay/candidates`,
  `GET /console/replay/:id`, `POST /console/replay/run`.

Replay (`apps/api/src/replay`) loads the source user-scoped, gates on
eligibility, reconstructs the original conversation input, persists a
`kind='replay'` placeholder with a self-FK to the source (`replay_of_inference_id`),
and drives a `StreamOrchestrator` against the pinned target provider. The run
streams async with no WS client (frames discarded); the diff is computed once
the output lands and surfaces on the next Traces/Replay refetch. In-flight
replays are registered so Clear can cancel them.

**Sample data** — `POST /console/samples/generate` seeds a `sample_workspaces`
row plus synthetic `kind='sample'` inferences so the console is non-empty on a
fresh account. The active workspace is pinned on `sessions.current_sample_workspace_id`.

---

## Decision 8 — Clear history: fence-first soft delete

Clearing the console must not leave a survivor if a stream finalizes mid-clear.
`ClearService` (`apps/api/src/console/clear.service.ts`) runs a strict order:

1. **Fence first** (own committed txn): upsert `user_clear_fences.clear_after_ts = now`
   so the projection consumer sees the fence immediately.
2. **`registry.cancelAll(userId)`** *outside* any transaction — wait for every
   in-flight orchestrator's terminal write to land (each commits on its own
   connection).
3. **Count + delete atomically** (own txn): delete `inferences` and
   `trace_events` with timestamp `< fence`, and return the per-kind breakdown.

The projection consumer independently reads the fence (`clear-fence.ts`) and
drops any redelivered span older than it, so a late OTel delivery can never
resurrect cleared data. `GET /console/clear/preview` shows what a clear would
remove without writing.

---

## Decision 9 — Liveness: live-events SSE + heartbeat badge + janitor

Three pieces keep the console honest about ingestion health without adding
Redis:

- **Live SSE.** After a chat/replay/sample turn commits to Postgres, the
  projection consumer publishes a snake_case `{ user_id, kind, conversation_id }`
  record to the Redpanda **`live-events`** topic (`live-events-publisher.ts`).
  The API's `LiveEventsConsumer` (group `api-live-fanout`) fans it out through
  an in-process `SseHub` to per-user SSE connections (`GET /console/live`), and
  the console refetches. Publish is *after* the DB commit, never on failure or
  duplicate; a missed tick degrades to the user's next manual refetch.
- **Heartbeat badge.** A scheduler emits one synthetic `llm.heartbeat` OTel
  span on an interval; the projection consumer lands it as a
  `kind='heartbeat'` trace event; the live-badge service reads it as the
  ingestion-health truth source (`GET /console/live/badge`, global, not
  user-scoped).
- **Janitor.** Sweeps `inferences` stranded in `status='streaming'` after an
  API restart (the orchestrator that owned them died, so the consumer will
  never enrich them). Predicate keys on `updated_at` (so a still-ticking stream
  is left alone) and the user-originated kinds only (`chat`/`replay`/`sample`);
  marks them `failed` with `error_code='api_restart'`.

---

## Decision 10 — Compose & Kubernetes topology

**Local (Docker Compose, `infra/compose`):** eight services, healthcheck-gated —
`web` (Next.js) · `api` (NestJS REST+WS) · `workers` (NestJS Redpanda consumer)
· `postgres` · `redpanda` · `redpanda-bootstrap` (one-shot topic creation) ·
`otel-collector` · `jaeger`. `api` runs `prisma migrate deploy` before the Nest
bootstrap. The `SESSION_SECRET` env uses fail-fast `${VAR:?}` syntax — Compose
refuses to render the api service without an explicit secret.

**Production (DOKS, `infra/k8s`):** web → Vercel; api + workers + Redpanda +
otel-collector + Jaeger → DOKS (`namespace: argus`); Postgres → Neon (managed).
ingress-nginx (one DO LoadBalancer) + cert-manager (Let's Encrypt) front the
API at `https://api-argus.duckdns.org` / `wss://…/ws/chat`. A `db-migrate` Job
runs `prisma deploy` before the api rolls. CI/CD (`.github/workflows/deploy.yml`)
builds → pushes to DOCR → migrates → rolls on every push to `main` touching
`apps/api`, `apps/workers`, `packages`, or `infra/k8s`. Full runbook:
[`infra/k8s/README.md`](../infra/k8s/README.md).

**Redis is intentionally absent.** The original Phase A plan assumed the
console's aggregations would need BullMQ + Redis; in practice live updates ride
the existing Redpanda spine via the `live-events` topic + SSE, and cost/traces
are direct indexed Postgres reads. No Redis, no second queueing system.

---

## Decision 11 — Error observability: Sentry

Both runtimes (`apps/api/src/observability/sentry.ts`,
`apps/workers/src/observability/sentry.ts`) capture errors through a single
`captureApiError({ err, feature, layer, extra })` helper with structured
context (feature/layer tags), gated on `SENTRY_DSN`. Recoverable degradations
(classifier fallback, a dropped live-events tick) are captured but do not fail
the request.

---

## Component map

`apps/web` renders `/chat` (auth-gated streaming UI), `/console`
(Traces/Cost/Replay), and `/login` + `/signup`. It opens one WS to the
Gateway and reduces frames into a per-conversation message log; the console
subscribes to the SSE feed and refetches REST aggregates. `apps/api` exposes
REST for auth, conversation CRUD, and the console; the WS Gateway for streaming;
the `auto` router; the `replay` engine; the `console` live SSE hub; the
`janitor` and `heartbeat` schedulers. `packages/sdk` owns provider selection,
the per-provider circuit breaker, OTel instrumentation, the context builder,
and Mock determinism. `apps/workers` consumes the `traces` topic, enriches the
Gateway-inserted `inferences` placeholder by `message_id`, writes `trace_events`,
honors the clear fence, and publishes `live-events` — it never touches
`messages.status`. `packages/contracts` holds the WS envelope, REST DTOs, OTel
attribute schema, live-events payload, and projection row shapes — authored
before either end so both compile against the same source of truth.

---

## Test partitioning

**TDD-able surfaces** (red→green pairs):
- Provider router: priority selection, circuit-breaker transitions, pre-first-token failover, post-first-token termination, pinning
- Mock provider: determinism (same `(conversationId, turnIndex)` ⇒ identical tokens)
- Context builder: drop-oldest under token cap, omitted-count indicator boundary
- Token-cost calculator: micro-USD math, missing-pricing-entry handling
- Auth service: password hash/verify, session issuance + revocation, WS ticket + cookie resolution, idempotent demo seed
- Auto router: classifier→category→provider mapping, keyword-heuristic fallback, classifier-failure degradation
- Clear service: fence-first ordering, per-kind breakdown, cancel-all wait
- Janitor: stranded-stream predicate (updated_at vs started_at, swept kinds)
- WS frame builder: envelope shape per type, `seq` monotonicity, `message_id` uniqueness
- Authorization filter: table-driven test rejecting cross-user reads
- Projection consumer: OTLP span → `inferences` mapping, failover-attempt linkage, idempotency on duplicate spans, clear-fence drop
- Replay: eligibility gate, input reconstruction, self-FK linkage, diff
- Contracts zod schemas: round-trip validation for every WS frame, REST DTO, and live-events payload

**Non-TDD-able surfaces** (smoke-test acceptance):
- `/chat` + `/console` UI — manual click-through; component snapshots
- WS handshake (cookie *and* `?token=` ticket) — local compose smoke
- OTel Collector + Redpanda + Jaeger wiring — compose-up healthcheck plus end-to-end smoke (one chat turn → one `inferences` row + one Jaeger trace + one console feed tick)
- Real-provider adapters — contract tests against recorded fixtures; live calls left to manual demo runs
- Prisma migrations — applied on `api`/`db-migrate` boot; smoke is `compose up` / `kubectl apply` on an empty volume succeeding

End-to-end (Playwright, `tests/e2e`) covers the golden path: signup / login /
logout, send / stream / cancel / retry, conversation list, resume via direct
URL.

---

## Not yet built (forward-compat preserved)

- **Evals** — golden-dataset runner; LLM-as-judge scoring; drift charts per (model × prompt-version)
- **True mid-stream resume** — reconnect to an in-flight stream with sequenced-delta replay. The `message_id`-in-envelope + monotonic `seq` contract already preserves the protocol space.
- **PII redaction** — SDK-side pre-write scrub; configurable patterns
- **Budget alerts** — threshold notifications on the Cost lens (the micro-USD aggregates are already there)

---

## Tradeoffs documented in code

- **OTLP wire encoding is JSON, not protobuf.** Collector exports as
  `otlp_json` so the projection consumer can `JSON.parse` directly. Protobuf
  would be 30-50% smaller on the wire; the swap is one Collector config line
  plus a request-deserializer call in the consumer. Deferred.

- **Failover detection runs in the projection consumer, not the SDK.** The
  SDK emits one span per attempt; the consumer's `failover-detector` infers
  attempt-vs-enrichment from `(message_id, provider, status)`. A purer design
  would have the SDK attach an explicit `llm.attempt_index` attribute.

- **No FK from `inferences.message_id → messages.id`.** Under retry, the
  projection consumer can land a span before the Gateway finishes the
  placeholder insert. We'd rather enrich-eventually than reject. Readers
  must handle orphan `inferences` rows (rare; possible during Gateway restart).

- **Auto-router classifier persists its own inference row** rather than
  reusing the chat turn's. This keeps `chat.stream` a pure model-call primitive
  (no projection double-count) at the cost of one extra `kind='classifier'`
  row per Auto turn.

- **Per-workspace `node_modules` copied in runner Dockerfiles.** pnpm
  installs workspace deps as symlinks; copying only root `node_modules`
  loses them. A deeper fix would rework tsconfig paths so packages resolve
  via node_modules symlinks instead of explicit path aliases.

- **`router.replace` over `window.history.replaceState` for the URL swap on
  the first `start` frame.** Works because `MessageStream` is hoisted into
  the chat layout — Next's route reconciliation no longer remounts the
  WS-connected component.
