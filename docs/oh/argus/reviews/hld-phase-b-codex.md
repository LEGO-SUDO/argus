## 0. Format Violations

1. HLD length over 120 lines.
   Quote: `## File-Change Inventory` through the 25-file list, plus long TDD and risk sections.
   Move to: LLD. Keep HLD to decisions, flows, and irreversible constraints.

2. API endpoint URLs are present.
   Quote: ``reviewer-facing `/console` (Traces, Cost, Replay)``
   Quote: ``single `/console/live` endpoint per user``
   Quote: ``reuse the `/chat` WS gateway``
   Move to: LLD API surface.

3. Configuration values / magic strings are present.
   Quote: ``llm.kind` attribute (`chat | classifier | replay | heartbeat`)``
   Quote: ``Auto = `gpt-4o-mini` classifier``
   Quote: ``model=keyword-fallback``
   Quote: `every 10 seconds`
   Quote: `thresholds (5s / 30s)`
   Move to: LLD or contracts/config section.

4. Exhaustive implementation inventory.
   Quote: ``apps/web/app/console/traces/*` — Traces tab...``
   Quote: ``apps/api/src/console/live.controller.ts` — SSE endpoint...``
   Quote: ``packages/db/prisma/migrations/0002_phase_b_console/*``
   Move to: LLD work breakdown.

5. Exhaustive edge-case enumeration in TDD.
   Quote: `empty inputs, identical inputs, large-output cap`
   Quote: `tie-breaking, empty-input default`
   Quote: `concurrent cancels idempotent; Clear ordering`
   Move to: LLD test plan.

## 1. Data Flow Correctness

1. SSE notification durability is underspecified.
   Quote: `pushes an "inferences changed" tick whenever the consumer commits a row`
   PostgreSQL `NOTIFY` is lossy for disconnected clients. `/console` must do initial fetch and reconnect fetch, not rely on ticks.

2. “Consumer commits” is ambiguous.
   Quote: `fired from the consumer's commit`
   If this means Kafka/Redpanda offset commit rather than the same Postgres transaction as the row insert, the UI can observe a tick before data is visible, or miss rows after a failed DB write.

3. Heartbeat is global but described as console state.
   Quote: `MAX(trace_events.created_at) WHERE llm.kind='heartbeat'`
   A synthetic heartbeat has no natural user. If filtered per user, it may never appear; if global, every user sees shared pipeline health. The HLD should state which.

4. Clear can race with projection.
   Quote: `cancel() on each, awaits terminal status, then deletes the user's inferences / trace_events`
   Already-emitted spans can still arrive after deletion and recreate rows. Needs a clear generation, cutoff timestamp, tombstone, or consumer-side discard rule.

5. Classifier linkage is internally inconsistent.
   Quote: `linked via classifier_for_message_id`
   Quote: `presence indicates a classifier inference linked to a main inference`
   The classifier runs before the main inference exists. Linking by message id and linking to a main inference are different models.

6. Replay through original provider lacks availability semantics.
   Quote: `including against the original provider`
   If the original provider key is missing, revoked, rate-limited, or model deprecated, Replay behavior is undefined.

7. Sample scope is visibility-only unless cleanup is specified.
   Quote: `sample_scope_key must equal the current session id for the row to surface`
   Logout hides rows but does not remove them. Aggregates and storage need explicit exclusion and cleanup behavior.

8. Live SUM assumes complete cost rows.
   Quote: `live SUM of micro-USD costs against inferences`
   Streaming failures, partial outputs, missing pricing, classifier fallback, and replay rows need one canonical inclusion predicate and completion-state filter.

## 2. One-Way Doors Not Flagged

1. `llm.kind` is a schema-routing contract, but marked mostly reversible.
   Quote: `The unifying primitive is a new OTel llm.kind attribute`
   Quote: `the projection consumer reads it to tag rows`
   This is a producer/consumer contract. Changing it later requires coordinated deployment and backfill.

2. Classifier persistence is a durable product semantic.
   Quote: `both classifier paths persist a row`
   Quote: `two-inferences-per-Auto-turn invariant holds`
   Once traces, replay, and aggregates depend on this invariant, removing classifier rows is a data/model migration.

3. Heartbeat as synthetic spans pollutes `trace_events` semantics.
   Quote: `The consumer lands it in trace_events like any other span`
   This permanently mixes health telemetry with request traces unless separated later by migration and query rewrites.

4. SSE as the live transport becomes a client contract.
   Quote: `/console opens one SSE stream on mount`
   Moving to WebSockets later changes browser lifecycle, reconnect, auth, and frontend client behavior.

5. Clear destructive semantics are not flagged.
   Quote: `deletes the user's inferences / trace_events / dependents in a single transaction`
   This is irreversible product behavior and affects auditability, replay references, and trace-detail links.

## 3. Missed Failure Modes

1. OTel Collector down: providers may succeed but no projection rows arrive; UI should show ingestion lag, not empty success.

2. Redpanda down or partitioned: spans may buffer, drop, or duplicate; idempotency and backpressure behavior are not specified.

3. Projection consumer down: `/chat` works, `/console` stale; heartbeat catches it only if heartbeat itself traverses the same path and alert query is correct.

4. Postgres `LISTEN/NOTIFY` connection drops: SSE may remain open while DB subscription is dead unless heartbeat/reconnect is handled server-side.

5. Multiple API replicas: in-memory orchestrator registry and heartbeat scheduler break.
   Quote: `single-replica compose deploy`
   This is acceptable for demo, but the HLD must state Clear and heartbeat are single-replica only.

6. API restarts during active chat/replay: registry is lost, Clear cannot cancel in-flight provider calls.

7. Provider timeout/rate limit during Auto classifier: routing fallback behavior is unspecified. Does it use keyword fallback, fail the turn, or route default?

8. Malformed or unknown `llm.kind`: HLD says default to chat, but that can turn heartbeat/classifier bugs into billable chat rows.

9. Replay diff on very large outputs: cap is mentioned, but truncation semantics are not. Reviewer could see misleading diffs.

10. Clear during consumer replay/backlog: old rows can be reprojected after delete unless there is a durable fence.

## 4. Simpler Alternatives

1. D1 Cost rollup: live SUM is already the simpler choice. Keep it, but centralize one exclusion predicate and completion filter.

2. D2 Auto classifier: for Phase B demo, keyword routing first with optional model classifier behind a feature flag is simpler. It still proves Auto behavior without adding classifier cost, failure, and linkage complexity.

3. D3 SSE: simpler than `LISTEN/NOTIFY` is SSE with short server-side polling on `MAX(updated_at)` per user. At small-scale scale, this avoids DB subscription lifecycle bugs.

4. D4 Replay diff: compute diff client-side for the selected replay only. Simpler backend, acceptable payload if outputs are already capped.

5. D5 Sample data: a dedicated orchestrator “mock run” is good, but session-bound visibility is fragile. Simpler: mark `is_sample=true` and attach `user_id`; clear all sample rows for that user.

6. D6 Heartbeat: simpler health signal is consumer-updated `pipeline_heartbeat` table with one row. Synthetic spans are more honest but add noise and query ambiguity.

7. D7 Replay as inference: correct architectural choice. Simpler refinement: make `llm.kind=replay` the source of truth and drop redundant `is_replay`, or explicitly justify both.

8. D8 Clear registry: for single-replica demo, this is acceptable. Simpler and safer: delete by durable `clear_after` fence and let cancellation be best-effort.

## 5. Quality Score

1. 6/10.

2. The core direction is coherent: projection layer, additive columns, shared orchestrator path, live console, and replay-as-inference are reasonable.

3. It is not ready for LLD decomposition because the HLD is too long, contains LLD material, and leaves important correctness gaps around Clear races, heartbeat scoping, classifier linkage, SSE durability, and single-replica assumptions.
