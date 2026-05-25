---
phase: hld
status: APPROVED
slug: argus
scope: phase-b
created: 2026-05-25
updated: 2026-05-25
revision: 4
---

# HLD: Argus — Phase B (Control Plane)

Phase B turns Phase A's captured inference stream into the reviewer-facing console (Traces, Cost, Replay) and lights up real providers with Auto routing. Phase A's schema and OTel pipeline are fixed substrate — Phase B is a query/projection layer plus one enum column on `inferences` and two small new tables, not a re-architecture. The unifying primitive is an OTel `llm.kind` attribute mirrored into a `kind` enum column on `inferences`; every aggregate becomes a single equality predicate.

## Architecture Decisions

### D1: Live cost rollup via SUM on `inferences`, no rollup table
**Choice:** Cost tab issues a live SUM of micro-USD costs against `inferences` per request, grouped by conversation/provider/model with the active time window. No materialized rollup.
**Rationale:** Phase A already stores costs as integer micro-USD with a `(user_id, created_at)` index; at small-scale volumes a per-user SUM is sub-50ms. A rollup adds a second source of truth and a staleness window that conflicts with the live promise.
**Alternatives:** Materialized view refreshed by cron (staleness); consumer-written rollup table (doubles the write path). README flags a rollup as "would do next" at scale.
**One-way door?** No.

### D2: Auto routing — real classifier when keyed, in-process heuristic with banner when keyless
**Choice:** When OpenAI is configured, Auto calls the configured classifier model, persists a row with `kind=classifier` linked to the user message via the classifier-FK, then routes the main turn — **two inferences per Auto turn.** When no OpenAI key is configured, Auto runs a deterministic in-process keyword heuristic, persists only the main inference, and `/chat` shows a banner under the provider selector explaining the local fallback. No synthetic `keyword-fallback` row ever exists.
**Rationale:** The keyed path is the honest demonstration; the keyless path keeps the demo on the rails without faking a row to preserve a UI invariant. The two-inference invariant is conditional on OpenAI being configured and locked as such.
**Alternatives:** Always persist a fallback row (pollutes Traces with non-model rows); skip classifier entirely (loses the routing demonstration). Banner over fake row resolves the consistency hack.
**One-way door?** No.

### D3: Live updates via workers-emitted `live-events` topic + api SSE fan-out
**Choice:** `apps/workers` (the projection consumer) publishes a small event to a NEW Kafka topic `live-events` AFTER successfully committing the row to Postgres. `apps/api` tails `live-events` with its own consumer group and fans out via an in-process per-user subscriber map to subscribed SSE streams. Tick payload is `{ user_id, kind, conversation_id }` — enough for tabs to decide whether to refetch their slice; tabs do not reconstruct state from the event. Because the tick is emitted post-commit, the client refetch is guaranteed to see the row (no read-your-writes race).
**Rationale:** Emitting the tick from the consumer post-commit eliminates the ordering race that an api-tails-`traces` design has. Two consumer groups on different topics is standard Kafka pub/sub. Postgres `LISTEN/NOTIFY` stays out (PgBouncer-incompatible). In-memory fan-out is correct for the single-replica compose deploy; README notes multi-replica would use sticky-by-user SSE routing or Redis pub/sub.
**Alternatives:** API tails `traces` directly (rejected — SSE tick can fire before projection commits); Postgres `LISTEN/NOTIFY` (rejected — PgBouncer); WebSocket (overkill for one-way); polling (perceptible lag).
**One-way door?** No.

### D4: Replay diff = `jsdiff.diffWords`, server-side (client-side acceptable)
**Choice:** Word-level diff computed in `apps/api` when the Replay detail loads; the precomputed diff structure ships to the client.
**Rationale:** `jsdiff` is the boring choice; word-level matches the PRD; server-side centralizes the pathological-large-output cap.
**Alternatives:** Client-side diff over the two output strings already in the page is an equally defensible LLD-time alternative (one fewer round-trip on diff toggle, library ships once); flagged for LLD discussion. Character-level rejected (noisy).
**One-way door?** No.

### D5: Sample data generated through the real pipeline, scoped by workspace not session
**Choice:** "Generate sample inferences" invokes the same orchestrator the chat gateway uses against the Mock provider, with `kind=sample` and a `sample_workspace_id` foreign key. A new `sample_workspaces` table holds `(id, user_id, created_at)`; the user's `sessions` row gains a nullable `current_sample_workspace_id` pointer. Generate-Samples creates a workspace and points the session at it; logout (or new login) leaves the workspace orphaned and the next Generate-Samples creates a fresh one. Console reads exclude sample rows unless their `sample_workspace_id` matches the session pointer.
**Rationale:** Separates row identity (workspace id, immutable) from visibility (session pointer, mutable). Resolves Replay-against-sample cleanly: replay rows inherit the source's `sample_workspace_id` so they stay visible in the same session, while their own `kind=replay` keeps them correctly tagged.
**Alternatives:** Session-id as the row predicate (fragile, ambiguous on Replay); direct row inserts (parallel write path, drift risk).
**One-way door?** Yes — `kind=sample` and `sample_workspace_id` become load-bearing once data exists. Clear flow keeps operational recovery cheap.

### D6: Heartbeat = synthetic OTel span on a fixed cadence, freshness derived from `trace_events` (DB is the sole source of truth)
**Choice:** A scheduler in `apps/api` emits a heartbeat span at a fixed cadence. The projection consumer lands it in `trace_events` like any other span. The live-badge service computes lag by querying `MAX(trace_events.created_at) WHERE kind='heartbeat'` on a small cadence (per SSE-served request or a ~1s tick) — cheap with the existing index. An in-memory cache is optional and purely an optimization, invalidated on each query; the DB row is authoritative. If Postgres is unreachable, the badge surfaces as `error (DB unreachable)` — which is the correct signal, because the entire data plane is degraded.
**Rationale:** A heartbeat traversing the entire pipeline is the only honest health signal — it catches Collector/Redpanda/consumer/DB failures uniformly. DB-as-truth eliminates the prior contradiction between in-memory tracker and persisted state, and removes any race where the badge shows live while persisted traces are stalled.
**Alternatives:** Process-level liveness (misses the data plane); per-component healthchecks (ambiguous on partial failure); in-memory-only tracker (rejected — hides DB-plane failures). A `pipeline_health` table updated on each persisted heartbeat is a simpler future alternative noted for LLD discussion.
**Storage growth mitigation:** Traces reads add a `WHERE kind != 'heartbeat'` clause so heartbeat rows never appear in the feed and aren't paginated over. No separate table — overhead is one predicate.
**One-way door?** No.

### D7: Replay is "just another inference" — no special-case path
**Choice:** Replay runs go through the same orchestrator and SDK path as `/chat`. The new row carries `kind=replay` and a self-FK to the source inference. Cost / throughput / error-rate default reads exclude `kind=replay`.
**Rationale:** A second code path would diverge from `/chat` semantics within weeks. One path means Replay inherits every Phase A invariant automatically.
**Alternatives:** Dedicated replay executor (drift); skip persistence (loses Traces visibility).
**One-way door?** Yes — every aggregate filters on `kind` once data exists.

### D8: Clear is graceful via in-memory cancel + durable fence
**Choice:** A new `user_clear_fences` table holds one row per user `(user_id, clear_after_ts)`. On Clear, `apps/api` writes/updates the fence, cancels in-flight orchestrators from the in-memory registry, then deletes the user's `inferences` / `trace_events` where `started_at < clear_after_ts`. The projection consumer checks the user's fence before inserting any row; spans older than the fence are dropped with an OTel log.
**Rationale:** In-memory cancel handles "aborting active operations…" UX. The durable fence solves the race where already-emitted spans arrive after delete — the consumer enforces the cutoff so deleted rows can't be reprojected.
**Alternatives:** In-memory cancel only (race risk); Redis-backed registry (premature; re-adds the deferred Redis service); soft-delete by `cleared_at` with async hard-delete (simpler race handling, documented for LLD discussion).
**One-way door?** No.

### D9: Boot-time + periodic janitor for stranded `status=streaming` rows, keyed on `updated_at`
**Choice:** On `apps/api` boot, a janitor sweeps `inferences` where `status='streaming'` AND `updated_at < now() - threshold` (last activity timestamp on the row), setting `status='failed'` with `error_code='api_restart'`. The sweep then repeats on a fixed cadence as a background task.
**Rationale:** Phase A D1 inserts placeholder rows synchronously before the provider call; D8's in-memory registry dies on api restart. Using `updated_at` (which Phase A's `messages` row already ticks per token bucket; `inferences.updated_at` ticks similarly on stream progress — LLD specifies the touch points) detects *actual* staleness rather than total stream duration, so legitimate long-running streams with an old `started_at` aren't swept by mistake.
**Alternatives:** `started_at`-based predicate (rejected — false-positives long streams); persistent registry in Redis/Postgres (premature; would re-add Redis).
**One-way door?** No.

## Component Map

`apps/web` gains `/console` (page + Traces/Cost/Replay tabs), shared `LiveBadge` / `ClearModal` / `SampleDataButton` components, and a typed SSE client; `/chat` gains the four-option provider selector and the keyless-Auto banner. `apps/api` gains the console REST handlers, the SSE fan-out subscriber (kafkajs consumer group on the NEW `live-events` topic), the Auto router, the orchestrator registry, the heartbeat scheduler, the live-badge service (queries `MAX(trace_events.created_at) WHERE kind='heartbeat'`), the janitor, the replay service, and a shared aggregates helper. `apps/workers` extends the projection mapper for `kind` routing and clear-fence enforcement, and publishes to the new `live-events` topic after each successful row commit. `packages/sdk` adds the classifier adapter and pricing snapshot extensions; the diff helper is a small util (LLD picks the package — likely `apps/api` or a shared util, not `packages/sdk`). `packages/db` migrates `0002_phase_b_kind_enum` (adds the `kind` enum column + classifier/replay FKs on `inferences`, plus `sample_workspaces` and `user_clear_fences` tables, plus the `current_sample_workspace_id` pointer on `sessions`). `packages/contracts` extends OTel attrs and adds the SSE event + console row shapes + `live-events` payload shape.

## Test-Driven Development

### TDD-able surfaces (red→green pairing)
- `apps/api` Auto router: classifier dispatch path; keyless fallback path; correct row persistence per branch.
- `apps/api` keyword heuristic: deterministic category mapping for the input space.
- `apps/api` orchestrator registry: register / cancel / await-terminal lifecycle; Clear cancel-then-delete ordering.
- `apps/api` aggregates helper: cost SUM and throughput counts under the `kind` enum filter, including missing-pricing surfacing.
- `apps/api` SSE fan-out subscriber: subscribe/unsubscribe lifecycle, per-user routing, debounce under burst.
- `apps/api` live-badge service: lag derivation from `MAX(trace_events.created_at) WHERE kind='heartbeat'`; DB-unreachable surfaces as `error`.
- `apps/api` janitor: stranded-streaming sweep correctness with `updated_at` predicate (long-running streams not swept).
- `apps/api` replay service: row persistence with correct kind + FK linkage; diff payload assembly.
- `apps/workers` projection mapper: `kind` routing (including `unknown` for unrecognized `llm.kind`); clear-fence enforcement; `live-events` publish-after-commit ordering; idempotency unchanged.
- `packages/sdk` classifier adapter and pricing snapshot lookups.
- `packages/contracts` schemas: round-trip for OTel attrs, SSE event shape, and `live-events` payload.

### Non-TDD-able surfaces
- `/console` three-tab UI shell and tab switching — manual click-through across empty, sample-populated, and real-traffic states.
- SSE end-to-end (workers commit → `live-events` → SSE → client refetch) — compose smoke: a chat turn appears in `/console` within the 5s bar without manual refresh.
- Live-badge transitions — manual: artificially lag the consumer, kill the heartbeat scheduler, kill Postgres, restore.
- Replay side-by-side and diff visuals — manual click-through plus component-level snapshot per pane state.
- `/chat` provider selector + keyless-Auto banner UX — manual.
- Sample-data lifecycle across login/logout — manual: generate, logout, re-login (gone), different user (no cross-visibility), Replay-against-sample (visible in same session).
- Clear modal type-to-confirm + abort UX — manual: trigger during an active stream, observe abort-then-delete.

## Regression Risk Surface

- **Backend:** Auto routing must not bypass the gateway's cancel/persist path. Janitor must not run before Postgres migrations apply on boot. SSE fan-out must debounce per-stream so a Generate-Samples burst doesn't trigger a refetch storm.
- **Shared contracts:** `kind` enum is additive but the projection consumer must map any unrecognized `llm.kind` to `unknown` (NOT `chat`) so version skew is visible in ops dashboards and never silently corrupts aggregates.
- **Projection consumer:** existing `(trace_id, span_id, name)` idempotency must hold for heartbeat spans — the Phase B backend-infra migration widens Phase A's `(trace_id, span_id)` constraint to a 3-column unique to support multi-event spans while preserving redelivery dedup (a redelivered span repeats identical tuples). New clear-fence check adds a per-row lookup — verify it stays cheap with an index on `user_clear_fences(user_id)`. New `live-events` publish must occur only after successful row commit.
- **Heartbeat storage:** Traces reads must include `WHERE kind != 'heartbeat'` everywhere or the feed bloats with health pings. Centralize in the aggregates helper.
- **Aggregates:** every default read filters on the `kind` enum (excluding `replay`, `sample` not-in-session, `heartbeat`, and `unknown` via existing equality filters); missing the filter in one place is the most likely regression vector.
- **Frontend-web:** SSE reconnect must not duplicate refetch storms; `/chat` WS reconnect logic is the reference. `Last-Event-ID` semantics are an LLD decision.
- **Compose:** no new services in Phase B — Redis remains deferred. Boot order unchanged. New Kafka topic `live-events` must be auto-created or declared in compose bootstrap.

## Forward-Compatibility Locks

- **`kind` enum on `inferences` (`chat | classifier | replay | sample | heartbeat | unknown`):** the single load-bearing predicate for every default read. `unknown` exists specifically to absorb version skew without corrupting aggregates — default reads exclude it automatically via their existing `kind=<expected>` equality filters; a small ops dashboard or log alert surfaces a non-zero count of `kind=unknown` rows. Adding a new value requires producer + consumer + read-helper updates in lockstep, versioned via `packages/contracts`.
- **Classifier FK semantics:** when `kind=classifier`, the classifier-FK points to the user message; consumers treat this as the linkage primitive (Traces renders classifier rows inline under the main row).
- **Sample workspace pointer:** `sample_workspace_id` is row identity (immutable); session's `current_sample_workspace_id` is visibility (mutable). Replay rows inherit the source's `sample_workspace_id`.
- **Conditional two-inferences-per-Auto-turn invariant:** holds only when OpenAI is configured; the keyless path is a single-row Auto with a banner.
- **`llm.kind` OTel attribute:** producer/consumer contract. Unrecognized values map to `kind=unknown` at projection time (never to `chat`).
- **`live-events` topic post-commit ordering:** workers MUST publish only after the DB commit succeeds; this contract is what removes the SSE read-your-writes race.

## Parameters Summary

Magic strings deferred to LLD/config: classifier model name; heartbeat cadence; live-badge green/amber/error thresholds; janitor stranded-row threshold (against `updated_at`) and sweep cadence; SSE refetch-tick debounce window; live-badge query cadence. Values fixed in the PRD (5s live bar, 30s ingestion-failure threshold) propagate as-is.

## Open Questions

None. Revision 3 resolves all Codex v1 + v2 architectural findings except the optional simpler alternatives (pipeline_health table for D6; soft-delete Clear for D8), which are documented in the LLD-time discussion notes.
