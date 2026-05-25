## 0. Format violations

1. **HLD length over 120 lines**  
   Offending: the full HLD is substantially over 120 lines.  
   Move to: split detail into LLD; keep HLD to decisions, component ownership, risks, and TDD partition.

2. **API endpoint URL**  
   Quote: "`/chat` shows a banner under the provider selector"  
   Quote: "`apps/web` gains `/console`"  
   Quote: "`/chat` gains the four-option provider selector"  
   Move to: LLD.

3. **Configuration values / magic strings**  
   Quote: "`kind` enum on `inferences` (`chat | classifier | replay | sample | heartbeat`)"  
   Quote: "A scheduler in `apps/api` emits a heartbeat span at a fixed cadence."  
   Quote: "synthetic OTel span every 10s"  
   Quote: "PRD (5s live bar, 30s ingestion-failure threshold)"  
   Move to: LLD/config, except the existence of `kind` can remain.

4. **Too much implementation detail for HLD**  
   Quote: "`apps/api` runs a second kafkajs consumer on the `traces` topic with a distinct group id"  
   Quote: "in-process `Map<user_id, Set<SSEResponse>>`"  
   Quote: "`jsdiff.diffWords`, server-side"  
   Move to: LLD.

5. **Schema detail exceeds HLD scope**  
   Quote: "`sample_workspaces` table holds `(id, user_id, created_at)`"  
   Quote: "`user_clear_fences` table holds one row per user `(user_id, clear_after_ts)`"  
   Quote: "`0002_phase_b_kind_enum`..."  
   Move to: LLD/migration design.

6. **Long consideration lists**  
   Quote: the full "Regression Risk Surface" and "Forward-Compatibility Locks" sections.  
   Move to: keep only top risks in HLD; move operational details to LLD.

7. **TDD section present**  
   No violation. It partitions TDD-able vs non-TDD-able surfaces.

## 1. Data flow correctness

1. **D3 SSE fan-out cannot reliably map spans to users without specifying source of truth.**  
   Quote: "On each span it looks up `user_id` in an in-process `Map<user_id, Set<SSEResponse>>`"  
   The span must already contain trustworthy `user_id`, or the API consumer must query projection state. If the span lacks `user_id`, fan-out drops or misroutes events.

2. **D3 has ordering ambiguity between SSE tick and DB projection.**  
   Quote: "Tabs use the tick as 'refetch your slice'"  
   The API fan-out consumer and worker projection consumer are independent Kafka groups. The SSE tick may arrive before the projection write commits, causing the client refetch to miss the row.

3. **D6 repeats the same race for heartbeat freshness.**  
   Quote: "The consumer lands it in `trace_events` like any other span. The SSE fan-out subscriber tracks the most recent heartbeat in-memory"  
   If the API tailer sees heartbeat before DB projection, the badge may show live while persisted traces are stalled. This undermines "entire pipeline" health.

4. **D6 contradicts itself on heartbeat visibility.**  
   Quote: "freshness from `trace_events`"  
   Quote: "tracks the most recent heartbeat in-memory"  
   Pick one. If freshness is from memory, DB failure may be hidden. If from `trace_events`, SSE subscriber cannot derive it solely from its own tail.

5. **D8 Clear delete predicate is probably wrong for replay/sample/classifier rows.**  
   Quote: "deletes the user's `inferences` / `trace_events` where `started_at < clear_after_ts`"  
   Rows without `started_at`, delayed projected rows, or trace events timestamped differently can survive. The fence must align to the timestamp actually carried by incoming spans.

6. **D8 needs transactional ordering.**  
   Quote: "writes/updates the fence, cancels in-flight orchestrators... then deletes"  
   The fence write and delete need a clear transaction boundary. If delete commits before fence or fence write fails after cancellation, old spans can reappear.

7. **D2 classifier linkage is unclear.**  
   Quote: "persists a row with `kind=classifier` linked to the user message via the classifier-FK"  
   Quote: "Classifier FK semantics: when `kind=classifier`, the classifier-FK points to the user message"  
   A classifier FK on `inferences` pointing to a message is semantically odd unless the existing schema has message IDs. Also unclear how the main inference links back to the classifier result.

8. **D5 session-scoped sample visibility is fragile across multiple active sessions.**  
   Quote: "the user's `sessions` row gains a nullable `current_sample_workspace_id` pointer"  
   If users can have multiple sessions/devices, visibility differs by session row. If session rows are recreated on login, orphan cleanup and replay visibility need clearer rules.

9. **D9 janitor may mark valid long streams failed.**  
   Quote: "started_at is older than a configured threshold"  
   Without heartbeat/progress per inference, slow legitimate streams can be swept. The threshold must be tied to last token/span activity, not only `started_at`.

10. **Unknown `kind` defaulting to `chat` is unsafe.**  
   Quote: "projection consumer must default unknown values to `chat`"  
   This preserves rows but corrupts aggregates. Safer default is `unknown` excluded from default reads, or reject with observability.

## 2. One-way doors not flagged

1. **`kind` enum is a one-way door, but D1/D6 treat it casually.**  
   Quote: "The unifying primitive is an OTel `llm.kind` attribute mirrored into a `kind` enum column"  
   Once all aggregates depend on it, changing taxonomy is expensive. It is later listed in Forward-Compatibility Locks, but each decision using it says "No" or omits the one-way-door impact.

2. **SSE over Kafka tailing creates a deployment-shape lock.**  
   Quote: "Postgres is out of the control plane for fan-out."  
   Quote: "correct for the single-replica compose deploy"  
   This locks Phase B to single API replica or sticky routing. D3 says "One-way door? No", but client live semantics and infra assumptions become coupled.

3. **Sample visibility via session pointer is a one-way door beyond D5.**  
   Quote: "session's `current_sample_workspace_id` is visibility (mutable)"  
   D5 flags this partly, but not the implication that auth/session model now participates in data visibility. That is hard to unwind if sessions change.

4. **Clear fence semantics are load-bearing.**  
   Quote: "The projection consumer checks the user's fence before inserting any row"  
   D8 says "One-way door? No", but this defines permanent deletion semantics and projection behavior. Changing later risks resurrecting or losing data.

5. **Default exclusion of replay from aggregates is product-semantic lock.**  
   Quote: "Cost / throughput / error-rate default reads exclude `kind=replay`."  
   D7 flags replay as one-way, but not the analytics decision. Billing/cost semantics may later need replay included.

## 3. Missed failure modes

1. **Kafka unavailable:** chat may still persist placeholder rows, but projection, SSE ticks, heartbeat, and traces stall. HLD does not define degraded UI or retry/backlog behavior.

2. **Postgres unavailable:** orchestrator persistence, cost reads, clear fence writes, janitor, and sample generation fail. HLD does not define whether chat blocks or runs without observability.

3. **OpenAI classifier times out:** D2 says keyed Auto calls classifier, but not fallback behavior, timeout budget, or whether main inference proceeds.

4. **Classifier succeeds but main inference fails:** two rows exist with mixed terminal states. Console rendering and cost aggregation need defined behavior.

5. **Main inference succeeds but trace projection lags:** user sees chat output but console does not update. HLD relies on SSE tick but has no reconciliation path.

6. **API process restarts:** in-memory SSE subscribers, orchestrator registry, heartbeat state, and cancel registry are lost. D9 covers streaming rows only, not SSE reconnection or active provider calls.

7. **Worker restarts during projection:** idempotency is mentioned, but clear-fence lookup plus partial writes across `trace_events` and `inferences` need transaction boundaries.

8. **Malformed or missing `llm.kind`:** defaulting to `chat` corrupts console semantics.

9. **Clock skew:** clear fences, heartbeat freshness, janitor thresholds, and time-windowed cost reads all depend on timestamps. Source clock ownership is not stated.

10. **Generate samples burst:** SSE debounce is mentioned as risk, but no backpressure or batching decision exists for orchestrator/provider load.

11. **Multi-tab/multi-session clear:** one session clearing data affects all sessions for a user. HLD does not state whether that is intended.

12. **Authorization leakage:** console reads filtered by user/session/sample workspace are central, but HLD does not call out auth checks as an architectural invariant.

## 4. Simpler alternatives

1. **D3 SSE fan-out:** emit SSE tick after the API writes/persists the inference row, and use polling fallback for projection-delayed trace enrichment. Simpler than a second Kafka consumer with ordering races.

2. **D6 heartbeat:** store a single `pipeline_health` row updated by the projection consumer when heartbeat is successfully persisted. Simpler reads, bounded storage, still validates Kafka-to-DB path.

3. **D5 sample data:** mark sample rows with `sample_batch_id` and expose latest batch per user. Avoid coupling visibility to session rows unless session-specific demos are required.

4. **D8 clear:** soft-delete by `cleared_at`/`hidden_after` in query predicates first, then async hard-delete. Simpler race handling and easier recovery than immediate delete plus durable fence.

5. **D9 janitor:** drive stranded detection from `updated_at` / last span time instead of `started_at`. Same simplicity, fewer false failures.

6. **D4 replay diff:** compute client-side from already loaded outputs unless output-size caps require server protection. HLD already admits this is acceptable; choose the simpler default.

7. **D1 live cost:** okay for Phase B. Add only a query abstraction, not a rollup. Current choice is already the simpler one.

8. **D2 keyless Auto:** persist an explicit `routing_reason` on the main inference instead of relying on banner-only behavior. Avoid fake classifier rows while preserving auditability.

9. **Unknown kind handling:** add `unknown` enum and exclude from aggregates. Simpler and safer than silently coercing to `chat`.

## 5. Quality score

1. **6/10**

2. Strong direction and useful decisions, but not ready for LLD decomposition as-is. The biggest issues are cross-consumer ordering races, contradictory heartbeat source of truth, unsafe unknown-kind defaulting, unclear clear-fence transaction semantics, and too much LLD-level implementation detail in the HLD.
