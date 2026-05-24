1. **HLD / PRD Violations**

   - **Pinned model is not actually used.** Router `makeCommitChunk()` reports `req.pin.model`, but the provider adapters still choose `this.opts.model ?? env ?? DEFAULT_MODEL`. A user can pin `openai:gpt-4o`, the metadata says `gpt-4o`, but the OpenAI adapter may call `gpt-4o-mini`. This violates the provider/model pin decision and creates bad cost/context metadata.
   - **PATCH live-catalog validation is wrong.** `ConversationsController` validates pins with `getCatalogEntry()`, which is only the pricebook, not the live configured picker catalog. It accepts configured-false providers if the model exists in `cost.ts`, contradicting “live catalog validation.”
   - **Pin fallback resolver has the same bug.** A persisted pin for an unconfigured but pricebook-known provider will not produce `pinFallback`.

2. **Wire-Protocol Invariants**

   - **Zero-length token path can violate sequencing.** Router forwards leading empty token chunks before emitting `commit`. The orchestrator treats every token as a WS `token`, so the client can see `start@0 → token@1 → metadata@1 → ...`, duplicating seq 1 and violating `metadata@1` before tokens.
   - Success path depends on every SDK stream emitting `commit`; if a non-router stream is injected and emits token/done only, the orchestrator completes without metadata. Tests allow optional collaborators, but the runtime invariant says metadata exactly once per completed turn.

3. **Bugs / Correctness**

   - **Malformed/unsupported pins can be persisted through PATCH** because validation checks static catalog existence, not configured adapter/model output from `listConfiguredProviders()`.
   - **Reported committed model can be false** because adapters ignore `req.pin.model`.
   - **Concurrent sends can contaminate history.** `startTurn()` inserts in a transaction, then reads history afterward in a separate query. Two concurrent sends in one conversation can include each other’s just-inserted user messages unpredictably.
   - No DB-level coupling check means non-controller writes can create half-pins. App guards exist, but the meter/gateway tolerate half-pins instead of surfacing data corruption.

4. **Ownership Boundaries**

   - No `apps/web` or `apps/workers/src/projection` changes in the diff.
   - Backend remains sole writer of `messages.status` and placeholder `inferences` rows.

5. **Test Coverage Gaps**

   - `GET /providers` tests instantiate the controller directly and do not verify `SessionGuard` 401 behavior, despite Task 70 requiring a mounted module/guard test.
   - No test proves PATCH rejects a pricebook-known but unconfigured provider. Current “provider not configured” test seeds a different Prisma instance, so it does not prove the intended case.
   - No test verifies adapters actually receive/use the pinned model.
   - No test covers leading empty token wire ordering through router + orchestrator.
   - Fallback test only covers catalog-missing model, not configured-missing provider.
   - Task 86’s “conversation DTO pins null in response” is not actually implemented; `conversationForDto` is discarded.

6. **OTel Observability Completeness**

   - New attrs exist, but observability is incomplete.
   - `llm.pinned_failure=false` is only set on non-pin failures, not on successful spans, while Task 90 expects false on success.
   - No truncation event or pin-fallback event appears in the diff.
   - Pin fallback is returned on REST but not logged/span-attributed.
   - Meter failures go to Sentry capture, but no structured log/span attr makes them queryable in the new observability surface.

7. **Quality Score**

   **6/10.** Broad surface is implemented and many contracts are tested, but two core correctness bugs remain: live-catalog validation uses the wrong source, and pinned model metadata can diverge from the actual model called. The empty-token sequencing issue is also a real wire-protocol failure.
