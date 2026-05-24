# HLD Review — Claude fallback (Gemini unavailable)

> Gemini cross-model failed with OAuth-cancelled (FALLBACK_REQUIRED). Claude general-purpose subagent dispatched in its place. Independence guarantee reduced.

1. ARCHITECTURE SOUNDNESS

Decision 1 (split frame) is sound but under-specified: the HLD says `provider-resolved` fires "immediately after the first `token` chunk is observed," yet provider/model are arguments to `runStream` today (passed in by the gateway pre-stream from the router decision). With pinned mode, provider/model are known at gateway entry — so "after first chunk" is theatre, not truth. In Auto mode the gateway also currently picks before streaming; the router does not expose which adapter actually committed. The HLD needs a router-level callback or a chunk-carried `providerMeta` (which the orchestrator already inspects in `done`, not on first token) for `provider-resolved` to carry real post-failover truth. As written, the frame fires with the gateway's pre-flight guess — same lie, later seq. Fragile.

Decision 3 is defensible. The "fully separate code path, not a flag inside the loop" callout in Regression Risk is the right instinct. But `ProviderError('pinned_provider_failed', ...)` collides with the existing `errorCodeOf` pass-through in the orchestrator — confirm the wire `errorCode` value is part of the contract, not just internal.

Decisions 2, 4, 5, 6 are reasonable.

2. ONE-WAY DOORS

Missed: (a) the SDK pricebook + context-window become public API (`packages/sdk/src/index.ts` export surface) — once shipped, removal is a semver-major. (b) The Prisma column naming (`pinnedProvider`/`pinnedModel` vs `pinned_provider`/`pinned_model`) — Prisma `@map` discipline must be set on day one or rename later breaks SQL projections. (c) The WS frame `seq` invariant: `provider-resolved` arrives between `start` (seq=0) and tokens (seq>=1). The HLD never says what `seq` value `provider-resolved` carries — that's a one-way contract decision absent from the doc. Same for `context` (post-`end` means seq > final end seq, which violates the current "terminal end" comment in `ws.ts`). (d) `GET /providers` payload shape is a public REST contract.

3. FILE-CHANGE INVENTORY GAPS

Missing from the inventory: (a) `apps/api/src/chat/__tests__/stream-orchestrator.test.ts` and any gateway/frame-builder tests asserting `start` carries provider/model — Regression Risk acknowledges them but they're not in the file list. (b) `packages/contracts/src/__tests__/` Zod schema tests. (c) `packages/sdk/src/__tests__/router.test.ts` for the override branch. (d) `apps/web/lib/__tests__/message-stream-reducer.test.ts`. (e) Prisma seed (`packages/db/prisma/seed.ts` if it exists) — pinned columns nullable so likely safe, but confirm. (f) `packages/contracts/src/index.ts` re-exports. (g) `apps/api/src/conversations/__tests__/` for PATCH expansion. (h) No mention of workers/projection consumers — verify none consume `WsStartFrame` shape; the HLD claims "only consumer is web" but doesn't show evidence. (i) `packages/sdk/src/otel.ts` — Observability section adds attributes there but it's not in the inventory.

4. TDD PARTITION

`ContextMeterService` is marked TDD-able — correct, but the "loads prior history and respects pin" logic in `ChatService.startTurn` is NOT listed and is the highest-value unit test (history-window selection, pin-aware truncation, never-drop-latest-user-message invariant from PRD). Add it. The `ProviderPicker` empty-state and disabled-during-streaming logic should be reducer-level/hook-level unit-testable, not just Playwright — partial mispartition. The "previously-pinned unavailable" fallback resolver (mentioned in inventory) deserves a unit test and is missing from the TDD list.

5. OBSERVABILITY GAPS

Missing: (a) span attr for the `provider-resolved` truth moment — if the gateway's pre-flight guess diverges from what the router commits, there is no way to detect the lie in traces. Add `llm.provider_resolved` + `llm.provider_guess` if they differ. (b) Context-window cap source — `llm.context_window_cap` (model's published value) vs `llm.context_tokens_budget` (effective post-min). Without both, "why was budget 8k not 10k?" is unanswerable. (c) Truncation event: when history is dropped to fit budget, log structured `chat.context.truncated` with turns_dropped count — new failure mode (model claims no memory of turn N) needs this for debug. (d) `conversation.pin.fallback` log when the persisted pin is no longer configured — the PRD requires a one-time inline notice; trace counterpart absent. (e) `context` frame emission failure path is undefined — what if `ContextMeterService` throws after `end`? No span attr, no log.

6. CROSS-REPO CONSISTENCY

The contracts bump (D1 + D5) is one-shot but the HLD says "PRs ship independently" (per PRD constraints). Intermediate state: if `packages/contracts` ships first with new frames, the gateway tests in `apps/api` break on the discriminated union exhaustive switches before the orchestrator is updated. Build-order risk in turbo: contracts → sdk → api → web. The HLD should mandate a single PR for the contracts + gateway frame-builder + reducer cases (the three exhaustive-switch consumers), then independent PRs for picker UI, context meter UI, markdown. As written, "PRs ship independently" + "contract revised once" are in tension. Also: `pnpm-lock.yaml` regen and turbo cache invalidation for `packages/sdk` (new modules change the dist hash) — not called out.

7. QUALITY SCORE

6.5/10. Solid decision rationale and clean component boundaries, but three real holes: (1) `provider-resolved` doesn't actually solve the lie problem unless the router exposes commit truth — currently it just relabels the same pre-flight guess; (2) WS `seq` semantics for the two new frame types are entirely unspecified despite `seq` being a load-bearing wire invariant; (3) the file inventory omits every test file that the Regression Risk section explicitly says will break. Fix those three before LLD.
