---
phase: lld
status: APPROVED
slug: argus
scope: phase-b
workstream: backend-api
builder: backend-api-worker
reviewer: oh-cross-model --model codex
tester: oh-cross-model --model codex
revision: 3
created: 2026-05-25
updated: 2026-05-25
---

# LLD: backend-api — Argus Phase B (Control Plane)

Phase B scope for `apps/api`: the Auto router (real classifier when OpenAI is configured, deterministic keyword heuristic when keyless), the Console REST surface (Traces / Cost / Replay reads + Generate-Samples + Clear), the SSE fan-out subscriber tailing the new `live-events` Kafka topic, the per-user orchestrator registry (chat + replay handles), the boot + periodic janitor for stranded `status='streaming'` rows, the heartbeat scheduler, the live-badge service (DB-as-truth via `MAX(trace_events.created_at)`), the aggregates helper centralizing every `kind`-enum-filtered SUM/COUNT, and the replay service (eligibility, input reconstruction, jsdiff assembly).

Failover lives in `packages/sdk` per HLD Phase A §D3 — see §Cross-LLD Dependencies. This LLD assumes the SDK chat stream surface implements the policy and tests it there.

Out of this LLD (covered elsewhere):
- Prisma schema migration `0002_phase_b_kind_enum` (kind enum, classifier/replay FKs, `sample_workspaces`, `user_clear_fences`, `sessions.current_sample_workspace_id`) — `packages/db` work in the infra LLD. This LLD declares the required columns and tables under §Cross-LLD Dependencies and consumes them via Prisma.
- Projection consumer changes (kind routing, clear-fence enforcement, `live-events` publish-after-commit) — `apps/workers` LLD.
- Real OpenAI / Anthropic / Gemini provider adapters, the failover state machine, and pricing snapshot extensions inside `packages/sdk` — `packages/sdk` Phase B LLD. This LLD consumes the existing SDK chat stream surface; the Auto router performs classification by calling the existing `@argus/sdk` `chat.stream` surface against `gpt-4o-mini` — no new SDK surface required.
- SSE event / `live-events` payload / console row zod schemas — `packages/contracts` Phase B LLD. This LLD imports them.
- `/console` page + Traces/Cost/Replay tab components, SSE client, four-option provider selector, keyless-Auto banner — `apps/web` Phase B LLD.

## Builder
**agent:** backend-api-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** see `~/.claude/skills/oh/prompts/builder-addendum.md`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the actual tests via the wrapper

## File Structure

- `apps/api/src/app.module.ts` — updated to import `AutoModule`, `ConsoleModule`, `OrchestratorModule`, `JanitorModule`, `HeartbeatModule`, `ReplayModule`, `LiveEventsModule`.
- `apps/api/src/main.ts` — updated to start the janitor (boot sweep + interval), the heartbeat scheduler, and the `live-events` consumer after `app.listen()`.
- `apps/api/src/common/clock.ts` — injectable wall-clock wrapper so janitor / live-badge / heartbeat tests can advance time deterministically.
- `apps/api/src/common/config.ts` — typed env config exposing classifier model name, OpenAI key presence flag, heartbeat cadence, janitor threshold + sweep cadence, live-badge green/amber/error thresholds, live-badge query cadence, SSE debounce window, replay output-size cap, Kafka `live-events` topic + consumer group.

- `apps/api/src/auto/auto.module.ts` — Nest module wiring the Auto router providers.
- `apps/api/src/auto/auto-router.service.ts` — entry point the chat gateway calls when the user selects `Auto`; orchestrates classifier-or-heuristic + main turn.
- `apps/api/src/auto/keyword-heuristic.ts` — deterministic in-process classifier returning a category.
- `apps/api/src/auto/category-to-provider.ts` — pure map from category to provider id (coding→anthropic, research→gemini, else→openai).
- `apps/api/src/auto/classifier-adapter.ts` — wraps a one-shot classification call to `chat.stream` (provider=openai, model=gpt-4o-mini), accumulates the streamed output, parses it to a category, and persists a `kind='classifier'` inference row linked to the user message via the classifier-FK.
- `apps/api/src/auto/auto-decision.ts` — value type describing a routing decision (provider + classifier inference id or null).

- `apps/api/src/orchestrator/orchestrator.module.ts` — Nest module exporting the registry.
- `apps/api/src/orchestrator/registry.ts` — per-user in-memory map of in-flight chat + replay orchestrator handles with `register`, `deregister`, `cancelAll`, `list`.
- `apps/api/src/orchestrator/handle.ts` — handle interface a registered orchestrator must satisfy (`messageId`, `kind`, `cancel()`).

- `apps/api/src/chat/chat.gateway.ts` — extended to read the `provider` field on the inbound `send` frame, route via `AutoRouterService` when `provider==='auto'`, and register/deregister with the orchestrator registry.
- `apps/api/src/chat/chat.service.ts` — extended to accept a `kind` + optional `classifierMessageId` + optional `replayOfInferenceId` + optional `sampleWorkspaceId` on the placeholder insert.

- `apps/api/src/console/console.module.ts` — Nest module wiring the Console REST + SSE surfaces.
- `apps/api/src/console/console.controller.ts` — REST handlers: `GET /console/traces`, `GET /console/cost`, `GET /console/replay/candidates`, `GET /console/replay/:id`, `POST /console/replay/run`, `POST /console/samples/generate`, `POST /console/clear`. **Does NOT own `/console/live`** — that route is exclusive to `live.controller.ts`.
- `apps/api/src/console/aggregates.ts` — shared query helpers issuing `kind`-filtered SUMs/COUNTs and computing missing-pricing surfaces.
- `apps/api/src/console/traces.repository.ts` — Prisma read methods for the Traces feed (filters + free-text search + pagination + ordering).
- `apps/api/src/console/cost.repository.ts` — Prisma read methods for the Cost tab (grouped + window).
- `apps/api/src/console/replay.repository.ts` — Prisma read methods for replay candidates and detail; writes happen via `ChatService.startTurn`.
- `apps/api/src/console/samples.service.ts` — Generate-Samples orchestrator: mints a `sample_workspaces` row, updates the session's `current_sample_workspace_id`, kicks off N orchestrator runs against Mock with `kind='sample'`.
- `apps/api/src/console/sample-prompts.ts` — pure fixture list of varied prompts (provider/model combinations) used by the samples service.
- `apps/api/src/console/clear.service.ts` — Clear orchestrator: writes/updates `user_clear_fences`, calls `Registry.cancelAll(userId)`, deletes user's `inferences` + `trace_events` where `started_at < fence` (see Task 88 for the precise ordering).
- `apps/api/src/console/live.controller.ts` — dedicated SSE handler exposing `GET /console/live` exclusively (separate file from the REST controller to keep the long-lived response semantics isolated).
- `apps/api/src/console/sse-hub.ts` — in-process `Map<userId, Set<Subscriber>>` with `subscribe`, `unsubscribe`, `publish`, plus per-stream debounce.
- `apps/api/src/console/live-events.consumer.ts` — kafkajs consumer on the `live-events` topic; for each event calls `SseHub.publish(userId, event)`.
- `apps/api/src/console/live-events.module.ts` — Nest module wiring the consumer + hub + their lifecycle hooks.
- `apps/api/src/console/live-badge.service.ts` — pure service computing green/amber/error from `MAX(trace_events.created_at) WHERE kind='heartbeat'` and the configured thresholds; surfaces `error (DB unreachable)` on query failure.
- `apps/api/src/console/sse-event.ts` — value type for the SSE tick payload (shape lives in contracts; this file is the encode helper).
- `apps/api/src/console/dto/traces-query.dto.ts` — zod-derived query schema for `GET /console/traces` (filters + search + window + cursor).
- `apps/api/src/console/dto/cost-query.dto.ts` — zod-derived query schema for `GET /console/cost`.
- `apps/api/src/console/dto/replay-candidates-query.dto.ts` — zod-derived query schema for `GET /console/replay/candidates`.
- `apps/api/src/console/dto/replay-run.dto.ts` — zod-derived body schema for `POST /console/replay/run`.
- `apps/api/src/console/dto/clear.dto.ts` — zod-derived body schema for `POST /console/clear` (the `CLEAR` confirmation token).
- `apps/api/src/console/dto/samples-generate.dto.ts` — zod-derived body schema for `POST /console/samples/generate` (optional `count`).

- `apps/api/src/replay/replay.module.ts` — Nest module wiring the replay service.
- `apps/api/src/replay/replay.service.ts` — eligibility check + input reconstruction + orchestrator invocation with `kind='replay'`.
- `apps/api/src/replay/replay-input-reconstructor.ts` — pure helper assembling system prompt + user message + history-up-to-turn + temperature + max-tokens from the source inference + its conversation.
- `apps/api/src/replay/replay-eligibility.ts` — pure predicate returning `eligible | eligible_with_warning | ineligible` for a source inference.
- `apps/api/src/replay/diff.ts` — pure helper around `jsdiff.diffWords` returning the change list capped at the configured output-size budget.

- `apps/api/src/janitor/janitor.module.ts` — Nest module wiring the janitor + its scheduler.
- `apps/api/src/janitor/janitor.service.ts` — sweep method marking stranded `status='streaming'` rows where `kind IN ('chat','replay','sample')` AND `updated_at < now() - threshold` as `failed` with `error_code='api_restart'`.
- `apps/api/src/janitor/scheduler.ts` — interval driver that calls `janitor.sweep()` at the configured cadence.

- `apps/api/src/heartbeat/heartbeat.module.ts` — Nest module wiring the scheduler.
- `apps/api/src/heartbeat/scheduler.ts` — interval driver emitting a synthetic OTel span with `llm.kind='heartbeat'` at the configured cadence.
- `apps/api/src/heartbeat/span-emitter.ts` — pure helper that opens, attributes, and ends the heartbeat span.

- `apps/api/test/common/clock.test.ts` — wall clock + fake clock behavior.
- `apps/api/test/common/config.test.ts` — defaults + override parsing + OpenAI-key-presence flag.
- `apps/api/test/auto/keyword-heuristic.test.ts` — category mapping table-driven test.
- `apps/api/test/auto/category-to-provider.test.ts` — category → provider id table-driven test.
- `apps/api/test/auto/classifier-adapter.test.ts` — persists `kind='classifier'` row + classifier-FK linkage.
- `apps/api/test/auto/auto-router.test.ts` — classifier dispatch path and keyless heuristic path; row counts; classifier-throws-falls-back-to-heuristic.
- `apps/api/test/orchestrator/registry.test.ts` — register / deregister / cancelAll / list lifecycle; per-user isolation.
- `apps/api/test/console/aggregates.test.ts` — cost SUM under `kind` filter, throughput counts under `kind='chat'`, missing-pricing surfacing, sample-workspace visibility, sparkline.
- `apps/api/test/console/traces.repository.test.ts` — filters combinable (provider × model × status × conversation), free-text search across input/output/title/error, kind!=heartbeat default, pagination order, time window, cross-user isolation.
- `apps/api/test/console/cost.repository.test.ts` — grouping by conversation/provider/model, window predicate, mock + replay exclusion by default with include toggle.
- `apps/api/test/console/replay.repository.test.ts` — candidate listing respects time window + user scope; detail returns metadata including captured error.
- `apps/api/test/console/samples.service.test.ts` — creates workspace, points session, kicks off N orchestrator runs tagged `kind='sample'`.
- `apps/api/test/console/clear.service.test.ts` — writes fence, cancels in-flight via registry, deletes rows where `started_at < fence`, leaves other users untouched, ordering race property.
- `apps/api/test/console/sse-hub.test.ts` — subscribe / unsubscribe / publish; per-user routing; debounce coalesces burst.
- `apps/api/test/console/live-events.consumer.test.ts` — Kafka message → `SseHub.publish` invocation with correct user id.
- `apps/api/test/console/live-badge.service.test.ts` — lag derivation, green / amber / error transitions, DB-unreachable → error.
- `apps/api/test/console/console.controller.test.ts` — REST endpoint shape, auth enforcement, validation errors mapped to 400, samples + clear + replay-run wiring.
- `apps/api/test/console/live.controller.test.ts` — SSE handshake, per-user subscription, initial badge state, disconnect cleanup, route-collision guard.
- `apps/api/test/replay/replay-eligibility.test.ts` — predicate over the source-status matrix per PRD.
- `apps/api/test/replay/replay-input-reconstructor.test.ts` — reconstructs system + user message + history + temperature + max-tokens; excludes tools / attachments / provider-specific; history boundary correctness.
- `apps/api/test/replay/replay.service.test.ts` — persists row with `kind='replay'` + self-FK; rejects ineligible source; sample inheritance; registry registration.
- `apps/api/test/replay/diff.test.ts` — word-level change list; output-size cap honored.
- `apps/api/test/janitor/janitor.service.test.ts` — sweeps stranded streaming rows where `updated_at` older than threshold; leaves recently-active rows alone; sets `error_code='api_restart'`; kind predicate excludes classifier/heartbeat.
- `apps/api/test/heartbeat/span-emitter.test.ts` — emitted span carries `llm.kind='heartbeat'` and a current timestamp.

## Cross-LLD Dependencies

### From `packages/db` (backend-infra Phase B LLD)
This LLD requires:
- `inferences.kind` — enum column with values `chat | classifier | replay | sample | heartbeat | unknown`, NOT NULL, default `unknown` so any pre-migration row is treated as version-skew.
- `inferences.classifier_of_message_id` — nullable FK to `messages.id`, set only on `kind='classifier'` rows, pointing at the user message that triggered the classification.
- `inferences.replay_of_inference_id` — nullable self-FK to `inferences.id`, set only on `kind='replay'` rows.
- `inferences.sample_workspace_id` — nullable FK to `sample_workspaces.id`, set on `kind='sample'` rows and inherited by `kind='replay'` rows whose source was sample.
- `inferences.updated_at` — `DateTime`, ticks on every row mutation (placeholder insert sets it, projection enrichment updates it, terminal-status writes update it); janitor's predicate keys on this column.
- `sample_workspaces` table — `(id PK, user_id FK→users.id ON DELETE CASCADE, created_at DEFAULT now())`.
- `user_clear_fences` table — `(user_id PK FK→users.id ON DELETE CASCADE, clear_after_ts NOT NULL)`. Index implicit via PK.
- `sessions.current_sample_workspace_id` — nullable FK to `sample_workspaces.id`, set on Generate-Samples, cleared on logout.
- A new index on `trace_events(kind, created_at DESC)` to support the live-badge `MAX(created_at) WHERE kind='heartbeat'` query cheaply. The `kind` field on trace_events is populated by the projection consumer from the OTel `llm.kind` attribute.
- `trace_events.user_id` — denormalized FK to `users.id` (populated by the projection consumer from `inferences.user_id`) so `ClearService.execute` can delete user-scoped trace events without a join. **If the schema does not carry this column, the builder pauses and files a db-LLD task.**

If any of these are missing when the builder starts, the builder pauses and files a db-LLD task — does not invent local shapes.

### From `packages/contracts` (Phase B contracts LLD)
This LLD imports:
- `SseTickSchema` / `SseTick` — the shape of one `live-events` tick (user_id, kind, conversation_id).
- `LiveEventPayloadSchema` — the kafkajs message value shape published by `apps/workers`.
- `TraceRowSchema`, `TracesQuerySchema`, `TracesResponseSchema` — Traces tab DTOs.
- `CostQuerySchema`, `CostResponseSchema` — Cost tab DTOs including partial-pricing fields.
- `ReplayCandidateSchema`, `ReplayCandidatesResponseSchema`, `ReplayDetailSchema`, `ReplayRunRequestSchema`, `ReplayRunResponseSchema` — Replay tab DTOs.
- `GenerateSamplesRequestSchema`, `GenerateSamplesResponseSchema` — samples DTOs.
- `ClearRequestSchema`, `ClearResponseSchema` — clear DTOs.
- `LiveBadgeStateSchema` — `{ state: 'live' | 'behind' | 'error', lagSeconds?: number, message?: string }`.
- `OtelLlmKindAttributeSchema` — `llm.kind` enum literal.
- `CONSOLE_LIVE_PATH` — `/console/live` constant.

### From `packages/sdk` (Phase B SDK LLD — separate workstream)
This LLD consumes:
- `sdkChat.stream(...)` — unchanged from Phase A signature; **the failover state machine (user-selected → openai → anthropic → gemini chain, max 3 attempts, skip already-tried, mock never substituted, classify error → retry-or-terminate, post-first-token failure terminates) is wholly inside the SDK per HLD Phase A §D3.** This LLD passes a `provider` hint and consumes the resulting iterator; failover behavior is tested in the sdk LLD, not here. Any test in this LLD that exercises a failure of an individual real provider stubs at the `sdkChat.stream` surface and treats the SDK's thrown `FailoverExhaustedError` as opaque.
- Argus `packages/sdk` (PR #4, commit b181118) already provides the real `chat.stream` surface with failover, OTel emission, and pricing — this LLD consumes it as-is; no SDK changes are owned by any Phase B LLD.

### Phase A internals consumed by this LLD
This LLD extends existing Phase A files (merged in commit `e7edcf0`). The builder pauses if any of these are absent:
- `apps/api/src/chat/stream-orchestrator.ts` — `StreamOrchestrator` class with `Emit` callback and `RunStreamInput`; this LLD registers/cancels handles against the orchestrator registry.
- `apps/api/src/chat/chat.gateway.ts` — Phase A WS gateway; extended by this LLD (Tasks 39–42).
- `apps/api/src/chat/chat.service.ts` — Phase A turn-starter; extended by this LLD (Task 43 family).
- `apps/api/src/auth/session.guard.ts` — Phase A `SessionGuard` for REST controllers; reused on every `/console/*` REST handler.
- `apps/api/src/common/prisma.service.ts` — Phase A Prisma provider token; injected into every repository in this LLD.
- `apps/api/src/observability/sentry.ts` — exports `captureApiError({ err, feature, layer, statusClass?, extra? })`. Every error-capture site in this LLD calls this helper directly. The `feature` union is widened by Task 0 (below) to include `'auto' | 'console' | 'replay' | 'live' | 'janitor' | 'heartbeat'`.
- `apps/api/test/fixtures/prisma-test-client.ts` — Phase A in-memory Prisma fixture exporting `createInMemoryPrisma()` and `InMemoryPrisma`. Every test in this LLD that needs the DB imports from this path. **This LLD extends the fixture (Task 0a below) to cover the new tables/columns** (`inferences.kind`, `inferences.classifier_of_message_id`, `inferences.replay_of_inference_id`, `inferences.sample_workspace_id`, `inferences.updated_at`, `sample_workspaces.*`, `user_clear_fences.*`, `sessions.current_sample_workspace_id`, `trace_events.kind`, `trace_events.user_id`).

### Pinned config defaults
Documented in `apps/api/src/common/config.ts`:
- `CLASSIFIER_MODEL` — default `'gpt-4o-mini'`; only used when an OpenAI key is configured.
- `OPENAI_API_KEY` presence — boolean derived field exposed on the config object so `AutoRouterService` can branch deterministically without re-reading env.
- `HEARTBEAT_INTERVAL_MS` — default `10000` (10s).
- `JANITOR_STRANDED_THRESHOLD_MS` — default `60000` (60s; longer than the heartbeat interval so a single missed tick does not look stranded).
- `JANITOR_SWEEP_INTERVAL_MS` — default `30000`.
- `LIVE_BADGE_GREEN_THRESHOLD_MS` — `5000`.
- `LIVE_BADGE_ERROR_THRESHOLD_MS` — `30000` (per PRD).
- `LIVE_BADGE_QUERY_CADENCE_MS` — `1000`.
- `SSE_DEBOUNCE_MS` — `100` (coalesce a Generate-Samples burst into one tick per ~100ms per user).
- `REPLAY_OUTPUT_SIZE_CAP_BYTES` — `262144` (256KB; over the cap, the diff helper returns a sentinel "too large to diff" instead of an array).
- `LIVE_EVENTS_TOPIC` — `'live-events'`.
- `LIVE_EVENTS_CONSUMER_GROUP` — `'api-live-fanout'`.
- `SAMPLES_DEFAULT_COUNT` — `8` (PRD says "handful").

---

## Tasks

### Task 0a: [non-TDD — dependency install] Add Phase B runtime dependencies to apps/api
**Files:** `apps/api/package.json`
**What to do:** Add `kafkajs`, `diff`, `@opentelemetry/api`, `@opentelemetry/sdk-node` to `dependencies`. Add `@types/diff`, `supertest`, `@types/supertest` to `devDependencies`. `zod` and `@sentry/node` are already present from Phase A — do not re-add.
**Acceptance:** `pnpm install` completes; new packages resolvable from `apps/api/src` imports.
**Verify:** `pnpm --filter @argus/api install && pnpm --filter @argus/api typecheck`

### Task 0b: [non-TDD — Sentry helper widening] Widen `captureApiError` feature union for Phase B
**Files:** `apps/api/src/observability/sentry.ts`
**What to do:** Add `'auto' | 'console' | 'replay' | 'live' | 'janitor' | 'heartbeat'` to the `feature` union of `CaptureApiErrorInput`. No behavior change otherwise.
**Acceptance:** Existing Phase A call sites still typecheck; new feature literals accepted.
**Verify:** `pnpm --filter @argus/api typecheck`

### Task 0c: [non-TDD — fixture extension] Extend `prisma-test-client` with Phase B columns and tables
**Files:** `apps/api/test/fixtures/prisma-test-client.ts`
**What to do:** Extend the in-memory fixture to support: `inferences.kind` enum field, `inferences.classifier_of_message_id`, `inferences.replay_of_inference_id`, `inferences.sample_workspace_id`, `inferences.updated_at`; a new `sampleWorkspace.{create,findFirst,findMany,delete}` surface; a new `userClearFence.{upsert,findUnique,delete}` surface; `sessions.current_sample_workspace_id` field; `traceEvent.{create,findMany,deleteMany,aggregate}` with `kind` and `user_id` fields. Keep the Phase A surfaces unchanged.
**Acceptance:** Phase A tests still pass against the extended fixture; the new fields and surfaces are addressable from new tests.
**Verify:** `pnpm --filter @argus/api test`

### Task 1 (RED): Failing test for `Clock.now()` returns wall-clock time
**Files:** `apps/api/test/common/clock.test.ts`
**What to do:** Write a failing test naming the behavior: the injectable clock returns a `Date` whose value is within 50ms of `Date.now()` at the moment of call.
**Acceptance:** Test exists, runs, fails because the clock service is unimplemented.
**Verify:** `pnpm --filter @argus/api test clock.test`

### Task 2 (GREEN): Implement `Clock`
**Files:** `apps/api/src/common/clock.ts`
**What to do:** Implement an injectable wall-clock wrapper exposing `now()` returning `new Date()` and `nowMs()` returning `Date.now()`.
**Acceptance:** Task 1 passes.
**Verify:** `pnpm --filter @argus/api test clock.test`

### Task 3 (RED): Failing test for `FakeClock.advance` deterministic time travel
**Files:** `apps/api/test/common/clock.test.ts`
**What to do:** Add a failing test naming the behavior: a `FakeClock` exported from the same module can be constructed with an initial timestamp and exposes an `advance(ms)` method that moves the returned `now()`/`nowMs()` forward by exactly the supplied amount.
**Acceptance:** Test exists, runs, fails because `FakeClock` is unimplemented.
**Verify:** `pnpm --filter @argus/api test clock.test`

### Task 4 (GREEN): Implement `FakeClock`
**Files:** `apps/api/src/common/clock.ts`
**What to do:** Implement the test fake as a separate exported class implementing the same interface.
**Acceptance:** Task 3 passes.
**Verify:** `pnpm --filter @argus/api test clock.test`

### Task 5 (RED): Failing test for `config` env parsing defaults
**Files:** `apps/api/test/common/config.test.ts`
**What to do:** Write a failing test naming the behavior: with no env overrides, the config exposes each documented default (classifier model, heartbeat cadence, janitor threshold + sweep cadence, live-badge thresholds + query cadence, SSE debounce, replay cap, live-events topic + group, samples default count) at the values pinned in this LLD.
**Acceptance:** Test exists, runs, fails because the config module is unimplemented.
**Verify:** `pnpm --filter @argus/api test config.test`

### Task 6 (RED): Failing test for `config` env override + validation
**Files:** `apps/api/test/common/config.test.ts`
**What to do:** Add a failing test naming the behavior: setting any of the documented env vars (e.g. `HEARTBEAT_INTERVAL_MS=2000`) before importing the config produces a config object whose corresponding field equals the parsed override; invalid values (non-integer where an integer is expected) cause a clear thrown error.
**Acceptance:** Test exists, runs, fails because the override + validation logic is unimplemented.
**Verify:** `pnpm --filter @argus/api test config.test`

### Task 7 (RED): Failing test for `config.openAiKeyConfigured` boolean derived field
**Files:** `apps/api/test/common/config.test.ts`
**What to do:** Add a failing test naming the behavior: when `OPENAI_API_KEY` is unset or empty, `config.openAiKeyConfigured === false`; when it is set to a non-empty string, `config.openAiKeyConfigured === true`. The actual key value is not exposed on the typed config (only the boolean) — secrets stay in process env.
**Acceptance:** Test exists, runs, fails because the derived field is unimplemented.
**Verify:** `pnpm --filter @argus/api test config.test`

### Task 8 (GREEN): Implement `config`
**Files:** `apps/api/src/common/config.ts`
**What to do:** Implement a zod-validated env loader exporting the typed config object with the documented defaults, the override parsing, and the `openAiKeyConfigured` derived boolean.
**Acceptance:** Tasks 5, 6, 7 pass.
**Verify:** `pnpm --filter @argus/api test config.test`

### Task 9 (RED): Failing test for keyword heuristic `coding` category
**Files:** `apps/api/test/auto/keyword-heuristic.test.ts`
**What to do:** Write a failing test naming the behavior: a table of representative coding prompts (e.g. containing "function", "stack trace", "rustc", "regex", "sql", "react", "compile") returns category `coding`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test keyword-heuristic.test`

### Task 10 (RED): Failing test for keyword heuristic `research` category
**Files:** `apps/api/test/auto/keyword-heuristic.test.ts`
**What to do:** Add a failing test naming the behavior: a table of representative research prompts (e.g. containing "summarize", "compare", "literature", "historical", "research", "explain in depth") returns category `research`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test keyword-heuristic.test`

### Task 11 (RED): Failing test for keyword heuristic `general` fallback and edge cases
**Files:** `apps/api/test/auto/keyword-heuristic.test.ts`
**What to do:** Add a failing test naming the behavior: prompts not matching coding or research keyword sets return category `general`; the categorization is case-insensitive; whitespace-only input returns `general`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test keyword-heuristic.test`

### Task 12 (GREEN): Implement `keyword-heuristic`
**Files:** `apps/api/src/auto/keyword-heuristic.ts`
**What to do:** Implement the heuristic as a pure function returning one of `coding | research | general` from a case-insensitive keyword match against two documented word lists; defaults to `general`.
**Acceptance:** Tasks 9, 10, 11 pass.
**Verify:** `pnpm --filter @argus/api test keyword-heuristic.test`

### Task 13 (RED): Failing test for `categoryToProvider` known mappings
**Files:** `apps/api/test/auto/category-to-provider.test.ts`
**What to do:** Write a failing test naming the behavior: `coding` maps to `'anthropic'`, `research` to `'gemini'`, `general` to `'openai'`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test category-to-provider.test`

### Task 14 (RED): Failing test for `categoryToProvider` unknown throws
**Files:** `apps/api/test/auto/category-to-provider.test.ts`
**What to do:** Add a failing test naming the behavior: an unknown category throws a clear error so schema drift surfaces immediately.
**Acceptance:** Test exists, runs, fails because the throw path is unimplemented.
**Verify:** `pnpm --filter @argus/api test category-to-provider.test`

### Task 15 (GREEN): Implement `categoryToProvider`
**Files:** `apps/api/src/auto/category-to-provider.ts`
**What to do:** Implement the pure mapper with an exhaustive switch on the category union; throws on any unrecognized value.
**Acceptance:** Tasks 13 and 14 pass.
**Verify:** `pnpm --filter @argus/api test category-to-provider.test`

### Task 16 (RED): Failing test for `ClassifierAdapter` persists `kind='classifier'` row from a stubbed `chat.stream`
**Files:** `apps/api/test/auto/classifier-adapter.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: invoking the adapter against a stubbed `chat.stream` that is called with provider=openai, model=gpt-4o-mini, and a classification prompt (a system instruction to emit one of `coding | research | general` plus the user message), then yields token chunks accumulating to "coding" followed by a done-chunk carrying provider/model meta — parses category=`coding`, inserts exactly one `inferences` row with `kind='classifier'`, `classifier_of_message_id` equal to the user message id, provider/model set from the done-chunk meta, `status='ok'`, and returns `coding` to the caller.
**Acceptance:** Test exists, runs, fails because the adapter is unimplemented.
**Verify:** `pnpm --filter @argus/api test classifier-adapter.test`

### Task 17 (RED): Failing test for `ClassifierAdapter` rejects on `chat.stream` failure without persisting
**Files:** `apps/api/test/auto/classifier-adapter.test.ts`
**What to do:** Add a failing test naming the behavior: when the stubbed `chat.stream` throws (mid-iteration), the adapter rejects with the error and inserts no `inferences` row.
**Acceptance:** Test exists, runs, fails because the failure path is unimplemented.
**Verify:** `pnpm --filter @argus/api test classifier-adapter.test`

### Task 18 (RED): Failing test for `ClassifierAdapter` defaults unrecognized output to `general`
**Files:** `apps/api/test/auto/classifier-adapter.test.ts`
**What to do:** Add a failing test naming the behavior: when the stubbed `chat.stream` yields an unrecognized word (e.g. "banana") followed by a done-chunk, the adapter parses the category as `general` and still persists exactly one `kind='classifier'` row with the classifier-FK and the done-chunk provider/model meta.
**Acceptance:** Test exists, runs, fails because the parse-default path is unimplemented.
**Verify:** `pnpm --filter @argus/api test classifier-adapter.test`

### Task 19 (GREEN): Implement `ClassifierAdapter`
**Files:** `apps/api/src/auto/classifier-adapter.ts`
**What to do:** Implement the adapter per the fold-in design: build the classification prompt (system instruction to output exactly one category word from `coding | research | general` plus the user message), call `chat.stream` with provider=openai and model=gpt-4o-mini, accumulate the streamed token chunks into a short string, trim/parse it to one of the three categories (default `general` on unrecognized output), persist the single `kind='classifier'` row with the FK and provider/model from the done-chunk meta via injected Prisma, and return the category; on a thrown stream, propagate without persisting. The adapter owns the row write — `chat.stream` is used purely as a model-call primitive, with no double-count.
**Acceptance:** Tasks 16, 17, and 18 pass.
**Verify:** `pnpm --filter @argus/api test classifier-adapter.test`

### Task 20 (RED): Failing test for `AutoRouterService` classifier dispatch path
**Files:** `apps/api/test/auto/auto-router.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: with `config.openAiKeyConfigured === true` (stubbed), routing a turn invokes `ClassifierAdapter`, persists exactly one classifier row, then returns an `AutoDecision` whose provider matches the classifier's category and whose `classifierInferenceId` references the persisted row.
**Acceptance:** Test exists, runs, fails because the router is unimplemented.
**Verify:** `pnpm --filter @argus/api test auto-router.test`

### Task 21 (RED): Failing test for `AutoRouterService` keyless heuristic path
**Files:** `apps/api/test/auto/auto-router.test.ts`
**What to do:** Add a failing test naming the behavior: with `config.openAiKeyConfigured === false`, routing a turn invokes the keyword heuristic, persists zero classifier rows, and returns an `AutoDecision` whose provider matches the heuristic's category and whose `classifierInferenceId` is null.
**Acceptance:** Test exists, runs, fails because the router is unimplemented.
**Verify:** `pnpm --filter @argus/api test auto-router.test`

### Task 22 (RED): Failing test for `AutoRouterService` classifier-throws-falls-back-to-heuristic
**Files:** `apps/api/test/auto/auto-router.test.ts`
**What to do:** Add a failing test naming the behavior: with `config.openAiKeyConfigured === true` but the classifier adapter stubbed to throw, the router falls back to the keyword heuristic for the routing decision, persists zero classifier rows, and returns a decision with `classifierInferenceId` null. The thrown error is forwarded to `captureApiError({ feature: 'auto', layer: 'service' })` but does not surface to the caller. **Classifier errors are explicitly NOT part of provider failover — they always fall back to heuristic.**
**Acceptance:** Test exists, runs, fails because the fallback is unimplemented.
**Verify:** `pnpm --filter @argus/api test auto-router.test`

### Task 23 (GREEN): Implement `AutoRouterService` + `AutoDecision`
**Files:** `apps/api/src/auto/auto-router.service.ts`, `apps/api/src/auto/auto-decision.ts`
**What to do:** Implement the service: detect OpenAI key presence via the config module, call the classifier adapter (which wraps `chat.stream`) when keyed (falling back to the heuristic on classifier throw with `captureApiError`), call the heuristic directly when keyless, return the `AutoDecision` value object.
**Acceptance:** Tasks 20, 21, 22 pass.
**Verify:** `pnpm --filter @argus/api test auto-router.test`

### Task 24 (RED): Failing test for `AutoModule` Nest testing module instantiation
**Files:** `apps/api/test/auto/auto.module.test.ts`
**What to do:** Write a failing test naming the behavior: a `Test.createTestingModule({ imports: [AutoModule], providers: [stub Prisma + stub config + stub SDK chat.stream] })` compiles and resolves `AutoRouterService` without missing-provider errors.
**Acceptance:** Test exists, runs, fails because `AutoModule` is unimplemented.
**Verify:** `pnpm --filter @argus/api test auto.module.test`

### Task 25 (GREEN): Wire `AutoModule`
**Files:** `apps/api/src/auto/auto.module.ts`
**What to do:** Declare the module exporting `AutoRouterService` and providing `KeywordHeuristic`, `ClassifierAdapter`, `categoryToProvider`; expects `PrismaService`, the SDK provider token, and the config to be available in the importing module's scope (re-export from a global `CommonModule` if Phase A does that, otherwise import in-place).
**Acceptance:** Task 24 passes.
**Verify:** `pnpm --filter @argus/api test auto.module.test`

### Task 26 (RED): Failing test for `OrchestratorRegistry.register` + `list`
**Files:** `apps/api/test/orchestrator/registry.test.ts`
**What to do:** Write a failing test naming the behavior: registering two handles under user A and one under user B; `list(userIdA)` returns exactly the two handles, `list(userIdB)` returns the one, in insertion order.
**Acceptance:** Test exists, runs, fails because the registry is unimplemented.
**Verify:** `pnpm --filter @argus/api test registry.test`

### Task 27 (RED): Failing test for `OrchestratorRegistry.deregister`
**Files:** `apps/api/test/orchestrator/registry.test.ts`
**What to do:** Add a failing test naming the behavior: after registering then deregistering a handle by `(userId, messageId)`, `list(userId)` no longer contains it; deregistering an unknown key is a silent no-op.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test registry.test`

### Task 28 (RED): Failing test for `OrchestratorRegistry.cancelAll` per-user scope
**Files:** `apps/api/test/orchestrator/registry.test.ts`
**What to do:** Add a failing test naming the behavior: with two handles for user A and one for user B (each handle a spy on `cancel()`), `cancelAll(userIdA)` calls `cancel()` on user A's two handles only; user B's handle is untouched; user A's handles are removed from the registry after the cancel resolves.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test registry.test`

### Task 29 (RED): Failing test for `OrchestratorRegistry.cancelAll` swallows handle errors
**Files:** `apps/api/test/orchestrator/registry.test.ts`
**What to do:** Add a failing test naming the behavior: when one of the user's handles throws from `cancel()`, the other handles still get cancelled and the call resolves; the thrown error is forwarded to `captureApiError({ feature: 'console', layer: 'service' })` but does not bubble.
**Acceptance:** Test exists, runs, fails because the resilience path is unimplemented.
**Verify:** `pnpm --filter @argus/api test registry.test`

### Task 30 (GREEN): Implement `OrchestratorRegistry` + `Handle`
**Files:** `apps/api/src/orchestrator/registry.ts`, `apps/api/src/orchestrator/handle.ts`
**What to do:** Implement the registry as a `Map<userId, Map<messageId, Handle>>` with the four methods; `cancelAll` iterates a snapshot, awaits each cancel inside a try/catch that captures and continues, then removes the user's bucket.
**Acceptance:** Tasks 26, 27, 28, 29 pass.
**Verify:** `pnpm --filter @argus/api test registry.test`

### Task 31 (RED): Failing test for `OrchestratorModule` instantiation
**Files:** `apps/api/test/orchestrator/orchestrator.module.test.ts`
**What to do:** Write a failing test naming the behavior: a `Test.createTestingModule({ imports: [OrchestratorModule] })` compiles and resolves `OrchestratorRegistry` as a singleton (two resolutions return the same instance).
**Acceptance:** Test exists, runs, fails because the module is unimplemented.
**Verify:** `pnpm --filter @argus/api test orchestrator.module.test`

### Task 32 (GREEN): Wire `OrchestratorModule`
**Files:** `apps/api/src/orchestrator/orchestrator.module.ts`
**What to do:** Declare a `@Global()` Nest module providing and exporting the registry as a singleton.
**Acceptance:** Task 31 passes.
**Verify:** `pnpm --filter @argus/api test orchestrator.module.test`

### Task 33 (RED): Failing test for gateway `send` frame `provider==='auto'` invokes `AutoRouterService`
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: a `send` frame with `provider='auto'` causes the gateway to invoke `AutoRouterService.route` before opening the SDK stream; the resolved provider id is passed to the orchestrator's `RunStreamInput.provider`.
**Acceptance:** Test exists, runs, fails because the extension is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 34 (RED): Failing test for gateway `send` frame `provider` pass-through for non-auto
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: a frame with `provider='openai'|'anthropic'|'gemini'|'mock'` bypasses the auto router (zero `AutoRouterService.route` calls) and passes the chosen provider through to the orchestrator unchanged.
**Acceptance:** Test exists, runs, fails because the branch is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 35 (GREEN): Extend gateway to read `provider` field and route via `AutoRouterService`
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Extend the gateway constructor to inject `AutoRouterService` and `OrchestratorRegistry`; in `handleSend`, branch on `frame.provider`; when `'auto'`, call the router and pass the resulting provider id into the orchestrator; otherwise pass `frame.provider` through.
**Acceptance:** Tasks 33 and 34 pass; existing Phase A gateway tests still pass.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 36 (RED): Failing test for gateway registers handle on `send` and deregisters on stream terminal
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: after a valid `send` frame is handled, the orchestrator registry contains a handle for the calling user keyed on the minted assistant message id; on stream terminal (success or error), the handle is removed.
**Acceptance:** Test exists, runs, fails because the registration wiring is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 37 (GREEN): Wire registry register/deregister into gateway
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** On successful orchestrator construction, call `registry.register(userId, handle)`; in the `.finally` block on `runStream()`, call `registry.deregister(userId, messageId)`.
**Acceptance:** Task 36 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 38 (RED): Failing test for `ChatService.startTurn` accepts `kind='chat'` default
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test naming the behavior: `startTurn` called without any new optional args writes the placeholder inference row with `kind='chat'` and all linkage columns null; existing Phase A tests for `startTurn` continue to pass.
**Acceptance:** Test exists, runs, fails because the default-kind extension is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 39 (RED): Failing test for `ChatService.startTurn` with `kind='replay'` + `replayOfInferenceId`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test naming the behavior: `startTurn` called with `kind='replay'` and a `replayOfInferenceId` writes the placeholder row with both columns set; the FK is the supplied source inference id.
**Acceptance:** Test exists, runs, fails because the extension is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 40 (RED): Failing test for `ChatService.startTurn` with `kind='sample'` + `sampleWorkspaceId`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test naming the behavior: `startTurn` called with `kind='sample'` and a `sampleWorkspaceId` writes the placeholder row with both columns set.
**Acceptance:** Test exists, runs, fails because the extension is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 41 (RED): Failing test for `ChatService.startTurn` with `kind='classifier'` + `classifierMessageId`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test naming the behavior: `startTurn` called with `kind='classifier'` and a `classifierMessageId` writes the placeholder row with both columns set.
**Acceptance:** Test exists, runs, fails because the extension is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 42 (GREEN): Extend `ChatService.startTurn` for `kind` + linkage fields
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Extend the method signature to accept optional `kind`, `classifierMessageId`, `replayOfInferenceId`, `sampleWorkspaceId`; default `kind` to `'chat'`; write the values onto the placeholder insert.
**Acceptance:** Tasks 38, 39, 40, 41 pass; Phase A `startTurn` tests still pass.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 43 (RED): Failing test for `Aggregates.costByConversation` chat-only default
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: with a user owning `kind='chat'`, `kind='replay'`, `kind='sample'` (in-session), `kind='classifier'`, and `kind='heartbeat'` rows of known cost, the cost aggregator default-grouped by conversation returns sums covering only `kind='chat'` rows; rows of every other kind are excluded.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 44 (GREEN): Implement `Aggregates.costByConversation` chat-only path
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Implement the SUM groupBy keyed on `user_id` + `kind='chat'` + the time window, returning per-conversation sums.
**Acceptance:** Task 43 passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 45 (RED): Failing test for `Aggregates.costByConversation` `includeReplay` toggle
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: passing `{ includeReplay: true }` adds `kind='replay'` rows to the sums (in addition to `kind='chat'`).
**Acceptance:** Test exists, runs, fails because the toggle is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 46 (GREEN): Implement `includeReplay` toggle
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Extend the kind filter to additionally accept `'replay'` when `includeReplay` is true.
**Acceptance:** Task 45 passes; Task 43 still passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 47 (RED): Failing test for `Aggregates.costByConversation` `includeMock` toggle
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: passing `{ includeMock: true }` adds rows whose provider is `'mock'` across the otherwise-included kinds; passing both toggles composes additively.
**Acceptance:** Test exists, runs, fails because the toggle is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 48 (GREEN): Implement `includeMock` toggle composition
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Extend the where clause to exclude `provider='mock'` by default and lift the exclusion when the toggle is true.
**Acceptance:** Tasks 43, 45, 47 all pass.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 49 (RED): Failing test for `Aggregates.costByConversation` missing-pricing surface
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: when some chat rows in a group have null `prompt_cost_usd_micros` / `completion_cost_usd_micros`, the aggregator returns the group with `pricedTotal` summing the priced rows and a parallel `unpricedCount` plus deduped `unpricedModels[]` listing the models without pricing.
**Acceptance:** Test exists, runs, fails because the surface is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 50 (GREEN): Implement missing-pricing surface
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Add a second pass over the rows (or a CASE/SUM in the same query) computing the unpriced count and distinct unpriced model list.
**Acceptance:** Task 49 passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 51 (RED): Failing test for `Aggregates.throughputForUser` chat-only count
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: with mixed-kind rows in the active window, throughput returns `turnsPerHour` and `tokensPerHour` counting `kind='chat'` rows only, and the error rate denominator likewise counts chat-only.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 52 (GREEN): Implement `Aggregates.throughputForUser`
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Implement the chat-only count + token SUM + status='ok' rate computation against the window.
**Acceptance:** Task 51 passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 53 (RED): Failing test for `Aggregates.errorRate` chat-only denominator
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: with chat rows split across `status='ok'`, `status='failed'`, `status='canceled'`, and `status='timed_out'`, the error rate is `(failed + timed_out) / total_chat_rows` and excludes replay/sample/heartbeat from both numerator and denominator.
**Acceptance:** Test exists, runs, fails because the rate computation is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 54 (GREEN): Implement `Aggregates.errorRate`
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Implement the rate as two scoped counts and a division (guard against divide-by-zero by returning 0 when the denominator is 0).
**Acceptance:** Task 53 passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 55 (RED): Failing test for `Aggregates.sparkline` per-hour spend
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: given chat rows spread across N hour buckets in the active window, the sparkline helper returns an array of N `{ hourStart, costMicros }` points in chronological order; empty hours have `costMicros=0`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 56 (GREEN): Implement `Aggregates.sparkline`
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Implement bucketization at `date_trunc('hour', started_at)` for chat-only rows, then left-join against a generated bucket series to backfill empty hours with zero.
**Acceptance:** Task 55 passes.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 57 (RED): Failing test for `Aggregates` sample-workspace visibility filter
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: when the session pointer `current_sample_workspace_id` is set, sample rows whose `sample_workspace_id` matches are visible to aggregates (and included when `kind='sample'` is enabled via an include toggle); sample rows from a different workspace are excluded regardless of toggles.
**Acceptance:** Test exists, runs, fails because the visibility predicate is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 58 (GREEN): Implement sample-workspace visibility predicate
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Add a final clause to every aggregate's where: `(kind != 'sample' OR sample_workspace_id = $currentSampleWorkspaceId)`.
**Acceptance:** Task 57 passes; Tasks 43–56 still pass.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 59 (RED): Failing test for `Aggregates.replayAndSampleExclusion` predicate isolation
**Files:** `apps/api/test/console/aggregates.test.ts`
**What to do:** Add a failing test naming the behavior: when both `includeReplay=false` and `includeSample=false` (defaults), no replay row and no sample row contributes to any aggregate even if its `sample_workspace_id` matches the active session.
**Acceptance:** Test exists, runs, fails because the exclusion is unimplemented.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 60 (GREEN): Implement explicit replay/sample exclusion
**Files:** `apps/api/src/console/aggregates.ts`
**What to do:** Tighten the kind filter so default behavior is `kind='chat'` only; toggles additively widen.
**Acceptance:** Task 59 passes; all prior aggregate tasks still pass.
**Verify:** `pnpm --filter @argus/api test aggregates.test`

### Task 61 (RED): Failing test for `TracesRepository.list` provider + status filters AND-combine
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: with mixed rows for one user, calling the list with `{ provider: 'openai', status: 'ok' }` returns only rows matching both.
**Acceptance:** Test exists, runs, fails because the repository is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 62 (GREEN): Implement provider + status filter composition
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Implement `list({ userId, provider, status })` with an AND-composed Prisma where clause.
**Acceptance:** Task 61 passes.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 63 (RED): Failing test for `TracesRepository.list` model + conversationId filter narrowing
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: adding `{ model: 'gpt-4o' }` to the prior filter narrows further; adding `{ conversationId }` narrows further still.
**Acceptance:** Test exists, runs, fails because the additional filters are unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 64 (GREEN): Implement model + conversationId filters
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Extend the where clause to include the two additional optional fields.
**Acceptance:** Task 63 passes.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 65 (RED): Failing test for `TracesRepository.list` free-text search across four columns
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: with a search term, the repository matches rows where the term appears in `input_preview`, `output_preview`, the joined conversation `title`, or `error_code`; the search is case-insensitive.
**Acceptance:** Test exists, runs, fails because the search is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 66 (GREEN): Implement free-text search
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Add a Prisma OR clause over the four columns with `mode: 'insensitive'`, scoped to the user.
**Acceptance:** Task 65 passes.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 67 (RED): Failing test for `TracesRepository.list` excludes `kind='heartbeat'` by default
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: with heartbeat rows seeded, the default list response never includes any `kind='heartbeat'` row, regardless of other filters.
**Acceptance:** Test exists, runs, fails because the exclusion is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 68 (GREEN): Implement heartbeat exclusion
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Add `kind: { not: 'heartbeat' }` to the base where clause.
**Acceptance:** Task 67 passes; prior tasks still pass.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 69 (RED): Failing test for `TracesRepository.list` time-window predicate
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: with rows seeded across 24h, 7d, and older buckets, calling with each window value returns only rows whose `started_at` falls inside the window; window `'all'` returns every row regardless of age.
**Acceptance:** Test exists, runs, fails because the window logic is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 70 (GREEN): Implement time-window predicate
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Compute the cutoff from `window` against an injected `Clock`; add `started_at >= cutoff` to the where; for `'all'`, skip the predicate.
**Acceptance:** Task 69 passes.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 71 (RED): Failing test for `TracesRepository.list` cursor pagination
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: with more rows than the page limit, the first call returns the newest N rows and a cursor; passing the cursor on the next call returns the next-older N rows with no overlap; passing an exhausted cursor returns an empty page and a null next-cursor.
**Acceptance:** Test exists, runs, fails because the pagination is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 72 (GREEN): Implement cursor pagination
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Order by `started_at` desc + `id` desc tie-break; encode the cursor as the compound `(started_at, id)` of the last returned row; on the next call, add `(started_at, id) < cursor` semantics; cap result to N+1 to detect end-of-feed.
**Acceptance:** Task 71 passes.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 73 (RED): Failing test for `TracesRepository.list` cross-user isolation
**Files:** `apps/api/test/console/traces.repository.test.ts`
**What to do:** Add a failing test naming the behavior: called with user A's id, the repository never returns user B's rows even when those rows match every other filter.
**Acceptance:** Test exists, runs, fails because the user scope is unimplemented.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 74 (GREEN): Enforce user scope on every read
**Files:** `apps/api/src/console/traces.repository.ts`
**What to do:** Confirm every query branch carries `userId` in the where clause (no method overload may omit it).
**Acceptance:** Task 73 passes; all prior tasks still pass.
**Verify:** `pnpm --filter @argus/api test traces.repository.test`

### Task 75 (RED): Failing test for `CostRepository.groupBy` conversation default
**Files:** `apps/api/test/console/cost.repository.test.ts`
**What to do:** Write a failing test naming the behavior: grouping by conversation returns one row per conversation in the user's window, each carrying `promptCostMicros`, `completionCostMicros`, `totalCostMicros`, and the conversation title; rows are ordered by total descending.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 76 (GREEN): Implement `CostRepository.groupBy` conversation
**Files:** `apps/api/src/console/cost.repository.ts`
**What to do:** Delegate to `Aggregates.costByConversation` and join `conversations` for the title.
**Acceptance:** Task 75 passes.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 77 (RED): Failing test for `CostRepository.groupBy` provider regrouping
**Files:** `apps/api/test/console/cost.repository.test.ts`
**What to do:** Add a failing test naming the behavior: passing `groupBy: 'provider'` returns one row per provider with the cost columns; ordered by total descending.
**Acceptance:** Test exists, runs, fails because the branch is unimplemented.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 78 (RED): Failing test for `CostRepository.groupBy` model regrouping
**Files:** `apps/api/test/console/cost.repository.test.ts`
**What to do:** Add a failing test naming the behavior: passing `groupBy: 'model'` returns one row per model; ordered by total descending.
**Acceptance:** Test exists, runs, fails because the branch is unimplemented.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 79 (GREEN): Implement provider + model regrouping
**Files:** `apps/api/src/console/cost.repository.ts`
**What to do:** Add the two branches; under the hood, switch the SUM groupBy key.
**Acceptance:** Tasks 77 and 78 pass.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 80 (RED): Failing test for `CostRepository.groupBy` default-excludes mock + replay
**Files:** `apps/api/test/console/cost.repository.test.ts`
**What to do:** Add a failing test naming the behavior: with chat rows from `mock` and from real providers plus `kind='replay'` rows, the default response excludes mock rows and replay rows; the include toggles add them back.
**Acceptance:** Test exists, runs, fails because the exclusion is unimplemented.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 81 (GREEN): Wire include toggles into `CostRepository`
**Files:** `apps/api/src/console/cost.repository.ts`
**What to do:** Pass `includeReplay` + `includeMock` straight through to the underlying `Aggregates` calls.
**Acceptance:** Task 80 passes.
**Verify:** `pnpm --filter @argus/api test cost.repository.test`

### Task 82 (RED): Failing test for `ReplayRepository.candidates` window + scope
**Files:** `apps/api/test/console/replay.repository.test.ts`
**What to do:** Write a failing test naming the behavior: listing replay candidates returns the user's `kind='chat'` rows in the active window with status in {ok, failed, canceled, timed_out} (status='streaming' rows are excluded — only terminal rows are replayable); a candidate from a different user is never returned.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 83 (GREEN): Implement `ReplayRepository.candidates`
**Files:** `apps/api/src/console/replay.repository.ts`
**What to do:** Implement the query with `userId` + `kind='chat'` + `status IN ('ok','failed','canceled','timed_out')` + window cutoff.
**Acceptance:** Task 82 passes.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 84 (RED): Failing test for `ReplayRepository.detail` returns metadata
**Files:** `apps/api/test/console/replay.repository.test.ts`
**What to do:** Add a failing test naming the behavior: detail for a successful inference returns provider, model, latency, tokens, cost, input preview, output preview.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 85 (RED): Failing test for `ReplayRepository.detail` carries error_code on failed source
**Files:** `apps/api/test/console/replay.repository.test.ts`
**What to do:** Add a failing test naming the behavior: detail for a `status='failed'` inference additionally carries the `error_code` field; for `status='ok'`, `error_code` is null.
**Acceptance:** Test exists, runs, fails because the error projection is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 86 (RED): Failing test for `ReplayRepository.detail` cross-user 404 returns null
**Files:** `apps/api/test/console/replay.repository.test.ts`
**What to do:** Add a failing test naming the behavior: detail for a different user's inference returns null (the controller maps to 404).
**Acceptance:** Test exists, runs, fails because the user scope is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 87 (GREEN): Implement `ReplayRepository.detail`
**Files:** `apps/api/src/console/replay.repository.ts`
**What to do:** Implement the user-scoped `findFirst` with the documented field projection.
**Acceptance:** Tasks 84, 85, 86 pass.
**Verify:** `pnpm --filter @argus/api test replay.repository.test`

### Task 88 (RED): Failing test for `replayEligibility` per-status matrix
**Files:** `apps/api/test/replay/replay-eligibility.test.ts`
**What to do:** Write a failing test naming the behavior: a source inference with `status='ok'` returns `eligible`; `status='failed'` and `status='timed_out'` return `eligible`; `status='canceled'` returns `eligible_with_warning` (partial-input warning per PRD); `status='streaming'` returns `ineligible`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay-eligibility.test`

### Task 89 (GREEN): Implement `replayEligibility`
**Files:** `apps/api/src/replay/replay-eligibility.ts`
**What to do:** Implement the pure predicate as an exhaustive switch on the source's status.
**Acceptance:** Task 88 passes.
**Verify:** `pnpm --filter @argus/api test replay-eligibility.test`

### Task 90 (RED): Failing test for `replayInputReconstructor` returns system + user + history + temp + max-tokens
**Files:** `apps/api/test/replay/replay-input-reconstructor.test.ts`
**What to do:** Write a failing test naming the behavior: given a source inference, its user message, its conversation, and its message history, the reconstructor returns an object containing the system prompt, the user message that triggered the turn, the prior history in chronological order, `temperature`, and `max_tokens`.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay-input-reconstructor.test`

### Task 91 (RED): Failing test for `replayInputReconstructor` history boundary excludes post-turn messages
**Files:** `apps/api/test/replay/replay-input-reconstructor.test.ts`
**What to do:** Add a failing test naming the behavior: messages whose `created_at` is greater than the source inference's user message `created_at` are NOT in the reconstructed history; the source's triggering user message IS in the history exactly once (as the final entry before the assistant turn).
**Acceptance:** Test exists, runs, fails because the boundary is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay-input-reconstructor.test`

### Task 92 (RED): Failing test for `replayInputReconstructor` excludes tools + attachments + provider-specific
**Files:** `apps/api/test/replay/replay-input-reconstructor.test.ts`
**What to do:** Add a failing test naming the behavior: given a source that carries hypothetical `tools`, `attachments`, or `providerSpecific` fields in its payload, the reconstructed input contains none of those keys.
**Acceptance:** Test exists, runs, fails because the exclusion is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay-input-reconstructor.test`

### Task 93 (GREEN): Implement `replayInputReconstructor`
**Files:** `apps/api/src/replay/replay-input-reconstructor.ts`
**What to do:** Implement the pure helper selecting the documented fields, applying the history boundary, dropping anything else.
**Acceptance:** Tasks 90, 91, 92 pass.
**Verify:** `pnpm --filter @argus/api test replay-input-reconstructor.test`

### Task 94 (RED): Failing test for `diff.diffWords` returns word-level change list
**Files:** `apps/api/test/replay/diff.test.ts`
**What to do:** Write a failing test naming the behavior: diffing two strings with a single replaced word returns a change list whose entries are tagged as added/removed/equal in chronological order, with the changed word isolated to its own added/removed pair.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test diff.test`

### Task 95 (RED): Failing test for `diff.diffWords` output-size cap
**Files:** `apps/api/test/replay/diff.test.ts`
**What to do:** Add a failing test naming the behavior: when either input exceeds the configured cap, the helper returns a sentinel `{ tooLarge: true }` instead of computing the diff; both inputs under the cap produce a normal change list.
**Acceptance:** Test exists, runs, fails because the cap is unimplemented.
**Verify:** `pnpm --filter @argus/api test diff.test`

### Task 96 (GREEN): Implement `diff`
**Files:** `apps/api/src/replay/diff.ts`
**What to do:** Implement the helper around `jsdiff.diffWords` with an upfront byte-length check against the config cap.
**Acceptance:** Tasks 94 and 95 pass.
**Verify:** `pnpm --filter @argus/api test diff.test`

### Task 97 (RED): Failing test for `ReplayService.run` eligibility check rejects ineligible source
**Files:** `apps/api/test/replay/replay.service.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: invoking `run` against a source inference with `status='streaming'` rejects with an `IneligibleReplayError` and writes no new inference row.
**Acceptance:** Test exists, runs, fails because the eligibility check is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 98 (GREEN): Implement `ReplayService.run` eligibility check step
**Files:** `apps/api/src/replay/replay.service.ts`
**What to do:** Implement the first step: call `replayEligibility(source)`, throw `IneligibleReplayError` on `ineligible`, continue on the other two.
**Acceptance:** Task 97 passes.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 99 (RED): Failing test for `ReplayService.run` input reconstruction step
**Files:** `apps/api/test/replay/replay.service.test.ts`
**What to do:** Add a failing test naming the behavior: against an eligible source, the service invokes `replayInputReconstructor` with the source inference and its conversation, then passes the assembled input to the next step (mock the SDK stream layer to capture the input it received).
**Acceptance:** Test exists, runs, fails because the reconstruction step is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 100 (GREEN): Implement `ReplayService.run` input reconstruction step
**Files:** `apps/api/src/replay/replay.service.ts`
**What to do:** Implement the second step: call `replayInputReconstructor` and hold the result for the next step.
**Acceptance:** Task 99 passes.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 101 (RED): Failing test for `ReplayService.run` persists `kind='replay'` row with self-FK
**Files:** `apps/api/test/replay/replay.service.test.ts`
**What to do:** Add a failing test naming the behavior: against an eligible source, `run` invokes `ChatService.startTurn` with `kind='replay'` and `replayOfInferenceId=source.id`; the persisted row carries both columns; the new assistant message id is returned.
**Acceptance:** Test exists, runs, fails because the persistence step is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 102 (GREEN): Implement `ReplayService.run` persistence step
**Files:** `apps/api/src/replay/replay.service.ts`
**What to do:** Implement the third step: call `ChatService.startTurn({ kind: 'replay', replayOfInferenceId: source.id, sampleWorkspaceId: source.sampleWorkspaceId ?? null, ... })`.
**Acceptance:** Task 101 passes.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 103 (RED): Failing test for `ReplayService.run` inherits `sample_workspace_id` from source
**Files:** `apps/api/test/replay/replay.service.test.ts`
**What to do:** Add a failing test naming the behavior: when the source inference is `kind='sample'` with a `sample_workspace_id`, the replay row inherits that `sample_workspace_id` so it stays visible in the same session per HLD D5.
**Acceptance:** Test exists, runs, fails because the inheritance is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 104 (GREEN): Implement sample-workspace inheritance
**Files:** `apps/api/src/replay/replay.service.ts`
**What to do:** Read `source.sample_workspace_id` and forward it on the `startTurn` call.
**Acceptance:** Task 103 passes.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 105 (RED): Failing test for `ReplayService.run` registers + deregisters handle
**Files:** `apps/api/test/replay/replay.service.test.ts`
**What to do:** Add a failing test naming the behavior: while `run` is in flight, the orchestrator registry contains a handle for the user keyed on the new assistant message id with `kind='replay'`; on terminal (success or error), the handle is removed.
**Acceptance:** Test exists, runs, fails because the registration is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 106 (GREEN): Implement orchestrator handle registration in replay
**Files:** `apps/api/src/replay/replay.service.ts`
**What to do:** Construct a `StreamOrchestrator` against the SDK stream (target provider from the request), register the handle via `OrchestratorRegistry.register`, fire-and-forget run with `.finally(() => registry.deregister(...))`.
**Acceptance:** Task 105 passes.
**Verify:** `pnpm --filter @argus/api test replay.service.test`

### Task 107 (RED): Failing test for `ReplayModule` Nest instantiation
**Files:** `apps/api/test/replay/replay.module.test.ts`
**What to do:** Write a failing test naming the behavior: `Test.createTestingModule({ imports: [ReplayModule, OrchestratorModule] })` compiles and resolves `ReplayService`.
**Acceptance:** Test exists, runs, fails because the module is unimplemented.
**Verify:** `pnpm --filter @argus/api test replay.module.test`

### Task 108 (GREEN): Wire `ReplayModule`
**Files:** `apps/api/src/replay/replay.module.ts`
**What to do:** Declare the Nest module exporting `ReplayService` and importing `OrchestratorModule`, the chat module, and the SDK provider.
**Acceptance:** Task 107 passes.
**Verify:** `pnpm --filter @argus/api test replay.module.test`

### Task 109 (RED): Failing test for `SamplesService.generate` creates workspace + points session
**Files:** `apps/api/test/console/samples.service.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` naming the behavior: invoking `generate` for a user creates exactly one new `sample_workspaces` row owned by the user; the user's `sessions.current_sample_workspace_id` is updated to the new workspace id (replacing any prior pointer).
**Acceptance:** Test exists, runs, fails because the service is unimplemented.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 110 (GREEN): Implement workspace + session pointer step
**Files:** `apps/api/src/console/samples.service.ts`
**What to do:** Inside a Prisma transaction, insert the workspace row and update the session pointer.
**Acceptance:** Task 109 passes.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 111 (RED): Failing test for `SamplesService.generate` kicks off N tagged orchestrator runs
**Files:** `apps/api/test/console/samples.service.test.ts`
**What to do:** Add a failing test naming the behavior: after `generate`, exactly N (default from config) placeholder `inferences` rows exist with `kind='sample'`, the new `sample_workspace_id`, varied provider/model combinations drawn from the sample-prompts fixture, and provider `'mock'` (sample turns never hit real providers).
**Acceptance:** Test exists, runs, fails because the loop is unimplemented.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 112 (GREEN): Implement N-orchestrator-runs loop
**Files:** `apps/api/src/console/samples.service.ts`, `apps/api/src/console/sample-prompts.ts`
**What to do:** Outside the transaction, loop over N prompts kicking off orchestrator runs against Mock with the sample kind + workspace id; each run is fire-and-forget and registered in the orchestrator registry.
**Acceptance:** Task 111 passes.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 113 (RED): Failing test for `SamplesService.generate` accepts custom count
**Files:** `apps/api/test/console/samples.service.test.ts`
**What to do:** Add a failing test naming the behavior: passing `{ count: 3 }` produces exactly 3 sample inferences.
**Acceptance:** Test exists, runs, fails because the count override is unimplemented.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 114 (RED): Failing test for `SamplesService.generate` rejects non-positive count
**Files:** `apps/api/test/console/samples.service.test.ts`
**What to do:** Add a failing test naming the behavior: passing `{ count: 0 }` or a negative number rejects with a validation error and no rows are written (transaction does not commit).
**Acceptance:** Test exists, runs, fails because the validation is unimplemented.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 115 (GREEN): Implement count override + validation
**Files:** `apps/api/src/console/samples.service.ts`
**What to do:** Validate count via the request DTO (zod), use the validated value (or `SAMPLES_DEFAULT_COUNT`) as the loop bound.
**Acceptance:** Tasks 113 and 114 pass.
**Verify:** `pnpm --filter @argus/api test samples.service.test`

### Task 116 (RED): Failing test for `ClearService.execute` writes fence with monotonic timestamp
**Files:** `apps/api/test/console/clear.service.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` + `FakeClock` naming the behavior: invoking `execute` upserts a `user_clear_fences` row with the user id and `clear_after_ts` equal to the current clock; running `execute` twice with the clock advanced 1s between calls updates the same row to the later timestamp.
**Acceptance:** Test exists, runs, fails because the fence write is unimplemented.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 117 (GREEN): Implement fence upsert step
**Files:** `apps/api/src/console/clear.service.ts`
**What to do:** Implement the upsert via Prisma `userClearFence.upsert({ where: { userId }, create: ..., update: { clear_after_ts } })`.
**Acceptance:** Task 116 passes.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 118 (RED): Failing test for `ClearService.execute` calls registry.cancelAll for the user
**Files:** `apps/api/test/console/clear.service.test.ts`
**What to do:** Add a failing test naming the behavior: with two registry handles for the user (chat + replay) and one handle for a different user, `execute` calls `registry.cancelAll(userId)` exactly once; the other user's handle is left untouched.
**Acceptance:** Test exists, runs, fails because the cancel step is unimplemented.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 119 (GREEN): Implement registry.cancelAll step
**Files:** `apps/api/src/console/clear.service.ts`
**What to do:** After the fence upsert, call `await registry.cancelAll(userId)`.
**Acceptance:** Task 118 passes.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 120 (RED): Failing test for `ClearService.execute` deletes user rows where started_at < fence
**Files:** `apps/api/test/console/clear.service.test.ts`
**What to do:** Add a failing test naming the behavior: with seeded `inferences` and `trace_events` rows for two users at varied `started_at`/`created_at` timestamps, `execute` deletes only rows belonging to the calling user whose timestamp is strictly less than the fence; rows from other users and rows at or after the fence are untouched.
**Acceptance:** Test exists, runs, fails because the delete predicate is unimplemented.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 121 (GREEN): Implement the user-scoped delete step
**Files:** `apps/api/src/console/clear.service.ts`
**What to do:** Implement `inferences.deleteMany({ where: { userId, started_at: { lt: fence } } })` and `traceEvents.deleteMany({ where: { user_id: userId, created_at: { lt: fence } } })` inside a single transaction.
**Acceptance:** Task 120 passes.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 122 (RED): Failing test for `ClearService.execute` cancel-then-delete race property
**Files:** `apps/api/test/console/clear.service.test.ts`
**What to do:** Add a failing test naming the behavior: simulate a handle that, when cancelled, commits a terminal-status row AFTER the fence has been written but BEFORE the delete pass runs (use a fake clock and a controlled cancel timing). After `execute` resolves, assert no rows survive whose `started_at < fence` — including the late terminal write — because the delete pass runs strictly after all cancels resolve.
**Acceptance:** Test exists, runs, fails because the ordering guarantee is unimplemented.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 123 (RED): Failing test for `ClearService.execute` returns counted breakdown
**Files:** `apps/api/test/console/clear.service.test.ts`
**What to do:** Add a failing test naming the behavior: `execute` returns an object with counts of deleted rows broken down by `kind` (chat, replay, sample) — matching the type-to-confirm modal's pre-display breakdown shape — so the controller can echo the actual deletion totals back to the client.
**Acceptance:** Test exists, runs, fails because the breakdown is unimplemented.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 124 (GREEN): Implement final ordering + breakdown
**Files:** `apps/api/src/console/clear.service.ts`
**What to do:** Implement the documented ordering exactly:
  1. Open Prisma transaction.
  2. Upsert fence row (within transaction).
  3. Commit transaction (so the fence is visible to projection consumer immediately).
  4. Outside the transaction, `await registry.cancelAll(userId)` — wait for every cancel's terminal status to land.
  5. Open a second Prisma transaction.
  6. Count rows per `kind` for the user where `started_at < fence` (for the breakdown).
  7. `inferences.deleteMany` and `traceEvents.deleteMany` under the same predicate.
  8. Commit the second transaction.
  9. Return the breakdown.

Step 4 happens outside the transaction because orchestrator commits are independent connections; step 6/7 happen inside the second transaction so the count and the delete are atomic against each other.
**Acceptance:** Tasks 122 and 123 pass; Tasks 116, 118, 120 still pass.
**Verify:** `pnpm --filter @argus/api test clear.service.test`

### Task 125 (RED): Failing test for `SseHub.subscribe` + `unsubscribe` lifecycle
**Files:** `apps/api/test/console/sse-hub.test.ts`
**What to do:** Write a failing test naming the behavior: subscribing a callback for a user adds it to the per-user set; unsubscribing the returned handle removes it; multiple subscribers for the same user coexist; a publish reaches all current subscribers.
**Acceptance:** Test exists, runs, fails because the hub is unimplemented.
**Verify:** `pnpm --filter @argus/api test sse-hub.test`

### Task 126 (RED): Failing test for `SseHub.publish` per-user routing
**Files:** `apps/api/test/console/sse-hub.test.ts`
**What to do:** Add a failing test naming the behavior: publishing to user A reaches user A's subscribers only; user B's subscribers receive nothing.
**Acceptance:** Test exists, runs, fails because the routing is unimplemented.
**Verify:** `pnpm --filter @argus/api test sse-hub.test`

### Task 127 (RED): Failing test for `SseHub.publish` debounce coalesces burst
**Files:** `apps/api/test/console/sse-hub.test.ts`
**What to do:** Add a failing test using **jest fake timers PLUS the `FakeClock`** naming the behavior: publishing 10 ticks for the same user within the debounce window results in the subscriber receiving exactly one tick after the debounce timer elapses; ticks at distinct kinds within the window still collapse to one tick. The test calls `jest.useFakeTimers()` and `jest.advanceTimersByTime(debounceMs)` to drive the actual Node timer; `FakeClock` is used for the timestamps inside the tick payload.
**Acceptance:** Test exists, runs, fails because the debounce is unimplemented.
**Verify:** `pnpm --filter @argus/api test sse-hub.test`

### Task 128 (RED): Failing test for `SseHub.publish` no subscribers is a no-op
**Files:** `apps/api/test/console/sse-hub.test.ts`
**What to do:** Add a failing test naming the behavior: publishing for a user with no subscribers does not throw and does not retain any state that would replay on a future subscribe.
**Acceptance:** Test exists, runs, fails because the no-subscriber path is unimplemented.
**Verify:** `pnpm --filter @argus/api test sse-hub.test`

### Task 129 (GREEN): Implement `SseHub`
**Files:** `apps/api/src/console/sse-hub.ts`
**What to do:** Implement the hub as a `Map<userId, { subscribers: Set<cb>, pendingTick: Tick | null, timer: NodeJS.Timeout | null }>`; subscribe returns an unsubscribe function; publish coalesces a pending tick and arms a `setTimeout` at the configured debounce; on timer fire, broadcast to all current subscribers and clear the pending state.
**Acceptance:** Tasks 125, 126, 127, 128 pass.
**Verify:** `pnpm --filter @argus/api test sse-hub.test`

### Task 130 (RED): Failing test for `LiveEventsConsumer` routes valid Kafka message to hub
**Files:** `apps/api/test/console/live-events.consumer.test.ts`
**What to do:** Write a failing test using a kafkajs stub naming the behavior: feeding a message whose value parses against `LiveEventPayloadSchema` causes the consumer to call `SseHub.publish` with the decoded `userId` and a tick containing `{ kind, conversationId }`.
**Acceptance:** Test exists, runs, fails because the consumer is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-events.consumer.test`

### Task 131 (RED): Failing test for `LiveEventsConsumer` skips malformed payload silently
**Files:** `apps/api/test/console/live-events.consumer.test.ts`
**What to do:** Add a failing test naming the behavior: a Kafka message whose value does not parse against the schema is forwarded to `captureApiError({ feature: 'live', layer: 'service' })` and skipped (no `SseHub.publish` call); the consumer continues to process subsequent messages.
**Acceptance:** Test exists, runs, fails because the validation path is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-events.consumer.test`

### Task 132 (GREEN): Implement `LiveEventsConsumer`
**Files:** `apps/api/src/console/live-events.consumer.ts`
**What to do:** Implement the consumer subscribing to the configured `live-events` topic + group on app boot; for each message, parse via the contracts schema, call `SseHub.publish` on success, capture-and-skip on failure; expose start/stop lifecycle hooks the module wires into `onApplicationBootstrap` / `onModuleDestroy`.
**Acceptance:** Tasks 130 and 131 pass.
**Verify:** `pnpm --filter @argus/api test live-events.consumer.test`

### Task 133 (RED): Failing test for `LiveEventsModule` Nest instantiation
**Files:** `apps/api/test/console/live-events.module.test.ts`
**What to do:** Write a failing test naming the behavior: `Test.createTestingModule({ imports: [LiveEventsModule] })` compiles and resolves both `LiveEventsConsumer` and `SseHub`.
**Acceptance:** Test exists, runs, fails because the module is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-events.module.test`

### Task 134 (GREEN): Wire `LiveEventsModule`
**Files:** `apps/api/src/console/live-events.module.ts`
**What to do:** Declare the module providing + exporting both classes; declare lifecycle hooks on the consumer.
**Acceptance:** Task 133 passes.
**Verify:** `pnpm --filter @argus/api test live-events.module.test`

### Task 135 (RED): Failing test for `LiveBadgeService.state` returns `live` under green threshold
**Files:** `apps/api/test/console/live-badge.service.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` + `FakeClock` naming the behavior: with the latest `kind='heartbeat'` row in `trace_events` having `created_at` 2 seconds before the fake clock's `now`, the badge state is `live` with `lagSeconds=2`. **Note:** the badge is computed globally (single ingestion health signal), not per-user — heartbeat rows are emitted system-wide.
**Acceptance:** Test exists, runs, fails because the service is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 136 (GREEN): Implement `LiveBadgeService.state` live branch
**Files:** `apps/api/src/console/live-badge.service.ts`
**What to do:** Implement the query `MAX(created_at) WHERE kind='heartbeat'` against `trace_events`; compute lag against `Clock.now()`; return `{ state: 'live', lagSeconds }` when under the green threshold.
**Acceptance:** Task 135 passes.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 137 (RED): Failing test for `LiveBadgeService.state` returns `behind` between thresholds
**Files:** `apps/api/test/console/live-badge.service.test.ts`
**What to do:** Add a failing test naming the behavior: with lag at 10 seconds (≥5s, <30s), the badge state is `behind` carrying the exact lag in seconds.
**Acceptance:** Test exists, runs, fails because the threshold logic is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 138 (GREEN): Implement `behind` branch
**Files:** `apps/api/src/console/live-badge.service.ts`
**What to do:** Add the threshold check returning `{ state: 'behind', lagSeconds }`.
**Acceptance:** Task 137 passes; Task 135 still passes.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 139 (RED): Failing test for `LiveBadgeService.state` returns `error` past error threshold
**Files:** `apps/api/test/console/live-badge.service.test.ts`
**What to do:** Add a failing test naming the behavior: with lag at 60 seconds (≥30s), the badge state is `error` with a message indicating ingestion failure.
**Acceptance:** Test exists, runs, fails because the error transition is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 140 (GREEN): Implement `error` branch
**Files:** `apps/api/src/console/live-badge.service.ts`
**What to do:** Add the third threshold returning `{ state: 'error', message: 'ingestion behind' }`.
**Acceptance:** Task 139 passes.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 141 (RED): Failing test for `LiveBadgeService.state` returns `live` on empty heartbeat history
**Files:** `apps/api/test/console/live-badge.service.test.ts`
**What to do:** Add a failing test naming the behavior: with zero heartbeat rows in `trace_events`, the badge state is `live` (per PRD: "no traffic at all" treated the same as fresh).
**Acceptance:** Test exists, runs, fails because the empty-history path is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 142 (GREEN): Implement empty-history branch
**Files:** `apps/api/src/console/live-badge.service.ts`
**What to do:** When the query returns null, return `{ state: 'live', lagSeconds: 0 }`.
**Acceptance:** Task 141 passes.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 143 (RED): Failing test for `LiveBadgeService.state` returns `error` on DB unreachable
**Files:** `apps/api/test/console/live-badge.service.test.ts`
**What to do:** Add a failing test naming the behavior: with the Prisma query stubbed to throw a connection error, the badge state is `error` with message `'DB unreachable'`; the underlying error is forwarded to `captureApiError({ feature: 'live', layer: 'service' })`.
**Acceptance:** Test exists, runs, fails because the DB-failure path is unimplemented.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 144 (GREEN): Implement DB-unreachable branch
**Files:** `apps/api/src/console/live-badge.service.ts`
**What to do:** Wrap the query in try/catch; on throw, `captureApiError` and return `{ state: 'error', message: 'DB unreachable' }`.
**Acceptance:** Task 143 passes.
**Verify:** `pnpm --filter @argus/api test live-badge.service.test`

### Task 145 (RED): Failing test for `JanitorService.sweep` marks stranded chat rows failed
**Files:** `apps/api/test/janitor/janitor.service.test.ts`
**What to do:** Write a failing test using `createInMemoryPrisma()` + `FakeClock` naming the behavior: with a `kind='chat'` + `status='streaming'` row whose `updated_at` is 120s before the fake clock and a threshold of 60s, the sweep updates exactly that row to `status='failed'` with `error_code='api_restart'` and stamps `ended_at` at the current clock.
**Acceptance:** Test exists, runs, fails because the service is unimplemented.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 146 (GREEN): Implement `JanitorService.sweep` core
**Files:** `apps/api/src/janitor/janitor.service.ts`
**What to do:** Implement the sweep as a single Prisma `updateMany` filtered by `kind IN ('chat','replay','sample')` AND `status='streaming'` AND `updated_at < clock.now() - threshold`, setting `status='failed'`, `error_code='api_restart'`, `ended_at = clock.now()`.
**Acceptance:** Task 145 passes.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 147 (RED): Failing test for `JanitorService.sweep` leaves recently-active streams alone
**Files:** `apps/api/test/janitor/janitor.service.test.ts`
**What to do:** Add a failing test naming the behavior: a `status='streaming'` row whose `updated_at` is 5s before the fake clock is left untouched by the sweep even when its `started_at` is far older (per HLD D9 the predicate keys on `updated_at`, not `started_at`).
**Acceptance:** Test exists, runs, fails because the predicate is incorrect or missing.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 148 (GREEN): Confirm predicate uses `updated_at`
**Files:** `apps/api/src/janitor/janitor.service.ts`
**What to do:** Verify the predicate from Task 146 keys on `updated_at`; if Task 147 fails, switch the predicate column.
**Acceptance:** Tasks 145 and 147 both pass.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 149 (RED): Failing test for `JanitorService.sweep` idempotency
**Files:** `apps/api/test/janitor/janitor.service.test.ts`
**What to do:** Add a failing test naming the behavior: running the sweep twice in succession against the same fixture mutates rows only on the first pass; the second pass affects zero rows because all stranded ones are now `status='failed'`.
**Acceptance:** Test exists, runs, fails if the predicate accidentally re-matches.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 150 (GREEN): Confirm idempotency via `status='streaming'` clause
**Files:** `apps/api/src/janitor/janitor.service.ts`
**What to do:** Verify the where clause includes `status='streaming'`; the second sweep finds zero rows because the first sweep set them to `failed`.
**Acceptance:** Task 149 passes.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 151 (RED): Failing test for `JanitorService.sweep` includes replay + sample kinds
**Files:** `apps/api/test/janitor/janitor.service.test.ts`
**What to do:** Add a failing test naming the behavior: a stranded `status='streaming'` `kind='replay'` row IS swept; a stranded `kind='sample'` row IS swept (these are real orchestrator runs that can strand on api restart).
**Acceptance:** Test exists, runs, fails if the kind filter is too narrow.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 152 (RED): Failing test for `JanitorService.sweep` excludes classifier + heartbeat kinds
**Files:** `apps/api/test/janitor/janitor.service.test.ts`
**What to do:** Add a failing test naming the behavior: a row with `kind='classifier'` AND `status='streaming'` (data corruption simulation — these rows should NEVER be `streaming` in normal operation since classifier is synchronous and heartbeat is synthetic) is NOT swept by the janitor; same for `kind='heartbeat'`. The janitor's scope is user-originated streams only; surviving classifier/heartbeat streaming rows are a signal of a different bug, not the janitor's responsibility.
**Acceptance:** Test exists, runs, fails if the kind filter doesn't include the exclusion.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 153 (GREEN): Confirm kind filter is `IN ('chat','replay','sample')`
**Files:** `apps/api/src/janitor/janitor.service.ts`
**What to do:** Verify the where clause includes the explicit `kind IN ('chat','replay','sample')` predicate.
**Acceptance:** Tasks 151 and 152 both pass; Tasks 145, 147, 149 still pass.
**Verify:** `pnpm --filter @argus/api test janitor.service.test`

### Task 154 (RED): Failing test for `JanitorModule` + scheduler instantiation
**Files:** `apps/api/test/janitor/janitor.module.test.ts`
**What to do:** Write a failing test naming the behavior: `Test.createTestingModule({ imports: [JanitorModule] })` compiles and resolves both `JanitorService` and `JanitorScheduler`; calling `scheduler.start()` triggers exactly one `sweep()` call immediately (verify via spy), then `scheduler.stop()` clears the interval (no further `sweep()` calls after stop).
**Acceptance:** Test exists, runs, fails because the module + scheduler are unimplemented.
**Verify:** `pnpm --filter @argus/api test janitor.module.test`

### Task 155 (GREEN): Wire `JanitorModule` + scheduler
**Files:** `apps/api/src/janitor/janitor.module.ts`, `apps/api/src/janitor/scheduler.ts`
**What to do:** Declare the module exporting `JanitorService` and `JanitorScheduler`; the scheduler exposes `start()` which calls `sweep()` immediately then sets a `setInterval` at the configured cadence, and `stop()` which clears the interval.
**Acceptance:** Task 154 passes.
**Verify:** `pnpm --filter @argus/api test janitor.module.test`

### Task 156 (RED): Failing test for `heartbeat span-emitter` attributes + timestamp
**Files:** `apps/api/test/heartbeat/span-emitter.test.ts`
**What to do:** Write a failing test naming the behavior: invoking the emitter against a stub OTel tracer creates one span whose attributes include `llm.kind='heartbeat'` and whose timestamps are taken from the injected clock; the span is ended within the same call.
**Acceptance:** Test exists, runs, fails because the emitter is unimplemented.
**Verify:** `pnpm --filter @argus/api test span-emitter.test`

### Task 157 (GREEN): Implement `heartbeat span-emitter`
**Files:** `apps/api/src/heartbeat/span-emitter.ts`
**What to do:** Implement the emitter calling `tracer.startSpan` with the documented attribute and immediately ending it.
**Acceptance:** Task 156 passes.
**Verify:** `pnpm --filter @argus/api test span-emitter.test`

### Task 158 (RED): Failing test for `HeartbeatModule` + scheduler instantiation
**Files:** `apps/api/test/heartbeat/heartbeat.module.test.ts`
**What to do:** Write a failing test naming the behavior: `Test.createTestingModule({ imports: [HeartbeatModule] })` compiles; calling `scheduler.start()` invokes the span emitter immediately (verify via spy), then `scheduler.stop()` clears the interval.
**Acceptance:** Test exists, runs, fails because the module + scheduler are unimplemented.
**Verify:** `pnpm --filter @argus/api test heartbeat.module.test`

### Task 159 (GREEN): Wire `HeartbeatModule` + scheduler
**Files:** `apps/api/src/heartbeat/heartbeat.module.ts`, `apps/api/src/heartbeat/scheduler.ts`
**What to do:** Declare the module providing the scheduler; scheduler exposes `start()` which emits one span immediately and then sets a `setInterval` at the configured cadence calling the emitter; `stop()` clears the interval.
**Acceptance:** Task 158 passes.
**Verify:** `pnpm --filter @argus/api test heartbeat.module.test`

### Task 160 (RED): Failing controller test for `GET /console/traces` shape + auth
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Write a failing test using a NestJS test module + `supertest` + `createInMemoryPrisma()` naming the behavior: an authenticated `GET /console/traces?window=24h` returns 200 with a body matching `TracesResponseSchema`; an unauthenticated request returns 401 (per Phase A `SessionGuard`); user A's response never contains user B's rows.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 161 (GREEN): Implement `GET /console/traces` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Implement the handler guarded by `SessionGuard`: parse query via `TracesQuerySchema`, delegate to `TracesRepository.list({ userId: req.user.id, ...query })`, serialize via `TracesResponseSchema`.
**Acceptance:** Task 160 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 162 (RED): Failing controller test for `GET /console/traces` query validation 400
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: query parameters parsed via `TracesQuerySchema` cover provider, model, status, conversationId, search, window, cursor; an invalid window value returns 400 with the validation error body in Phase A's error envelope shape (referenced from `apps/api/src/common/authorization.filter.ts`).
**Acceptance:** Test exists, runs, fails because the validation wiring is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 163 (GREEN): Wire zod validation + Phase A error envelope
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse with `TracesQuerySchema.safeParse`; on failure, throw `BadRequestException` carrying the zod issues, which the existing Phase A exception filter renders into the envelope.
**Acceptance:** Task 162 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 164 (RED): Failing controller test for `GET /console/cost` shape
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: the cost endpoint returns 200 with a body matching `CostResponseSchema` including grouped rows, total spend, the sparkline array, and the missing-pricing surface when present.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 165 (GREEN): Implement `GET /console/cost` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse query via `CostQuerySchema`, delegate to `CostRepository.groupBy`, also call `Aggregates.sparkline`, serialize via `CostResponseSchema`.
**Acceptance:** Task 164 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 166 (RED): Failing controller test for `GET /console/replay/candidates`
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: the candidates endpoint returns 200 with a body matching `ReplayCandidatesResponseSchema` listing the user's eligible candidates in the active window.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 167 (GREEN): Implement `GET /console/replay/candidates` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse query via `ReplayCandidatesQuerySchema`, delegate to `ReplayRepository.candidates`, serialize via the response schema.
**Acceptance:** Task 166 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 168 (RED): Failing controller test for `GET /console/replay/:id` detail + cross-user 404
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: the detail endpoint returns 200 with a body matching `ReplayDetailSchema` when the caller owns the source; calling with another user's id returns 404.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 169 (GREEN): Implement `GET /console/replay/:id` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Read the path param, call `ReplayRepository.detail({ userId, id })`, return 200 + serialized body or throw `NotFoundException` on null.
**Acceptance:** Task 168 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 170 (RED): Failing controller test for `POST /console/replay/run` returns new id
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a valid body parsed via `ReplayRunRequestSchema` (sourceInferenceId + target provider + target model) returns 200 with a body containing the new replay assistant message id.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 171 (RED): Failing controller test for `POST /console/replay/run` validation + cross-user 404
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: an invalid body returns 400; a body referencing another user's source returns 404.
**Acceptance:** Test exists, runs, fails because the error mapping is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 172 (GREEN): Implement `POST /console/replay/run` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse body, call `ReplayService.run({ userId, ...body })`; map `IneligibleReplayError` to 400, source-not-found to 404, success to 200 + new id.
**Acceptance:** Tasks 170 and 171 pass.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 173 (RED): Failing controller test for `POST /console/samples/generate` happy path
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a `POST` with `{ count: 5 }` returns 200 with a body containing the new workspace id and the kicked-off count.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 174 (RED): Failing controller test for `POST /console/samples/generate` validation 400
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a body with a non-positive count returns 400 with the validation error envelope.
**Acceptance:** Test exists, runs, fails because the validation wiring is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 175 (GREEN): Implement `POST /console/samples/generate` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse body via `GenerateSamplesRequestSchema`, call `SamplesService.generate({ userId, count })`, serialize response.
**Acceptance:** Tasks 173 and 174 pass.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 176 (RED): Failing controller test for `POST /console/clear` requires `confirmation: 'CLEAR'`
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a body with `confirmation: 'CLEAR'` returns 200 with the deletion breakdown.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 177 (RED): Failing controller test for `POST /console/clear` rejects other confirmation strings
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: any other confirmation string returns 400 and writes no fence and deletes no rows.
**Acceptance:** Test exists, runs, fails because the validation is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 178 (GREEN): Implement `POST /console/clear` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Parse body via `ClearRequestSchema` (which requires the literal `'CLEAR'`), call `ClearService.execute({ userId })`, serialize the breakdown.
**Acceptance:** Tasks 176 and 177 pass.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 179 (RED): Failing controller test for `ConsoleController` does NOT register `GET /console/live`
**Files:** `apps/api/test/console/console.controller.test.ts`
**What to do:** Add a failing test naming the behavior: enumerating the controller's registered routes (via Nest's route discovery) shows no handler for `GET /console/live`; that path is owned exclusively by `LiveController`. Hitting `GET /console/live` against a test app where only `ConsoleController` is registered returns 404.
**Acceptance:** Test exists, runs, fails until the route collision is removed.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 180 (GREEN): Ensure `ConsoleController` has no `/console/live` handler
**Files:** `apps/api/src/console/console.controller.ts`
**What to do:** Confirm by inspection (no `@Get('/console/live')` decorator on this controller).
**Acceptance:** Task 179 passes.
**Verify:** `pnpm --filter @argus/api test console.controller.test`

### Task 181 (RED): Failing test for `ConsoleModule` Nest instantiation
**Files:** `apps/api/test/console/console.module.test.ts`
**What to do:** Write a failing test naming the behavior: `Test.createTestingModule({ imports: [ConsoleModule, OrchestratorModule, AuthModule] })` compiles and resolves `ConsoleController` with all its dependencies (repositories + services) wired.
**Acceptance:** Test exists, runs, fails because the module is unimplemented.
**Verify:** `pnpm --filter @argus/api test console.module.test`

### Task 182 (GREEN): Wire `ConsoleModule`
**Files:** `apps/api/src/console/console.module.ts`
**What to do:** Declare the module exporting the controller and providing the repositories + services; import `AuthModule`, `OrchestratorModule`, `ReplayModule`, the chat module, and the SDK + Prisma providers.
**Acceptance:** Task 181 passes.
**Verify:** `pnpm --filter @argus/api test console.module.test`

### Task 183 (RED): Failing test for `GET /console/live` SSE handshake
**Files:** `apps/api/test/console/live.controller.test.ts`
**What to do:** Write a failing test using a NestJS test module + a connected supertest stream naming the behavior: an authenticated `GET /console/live` responds with status 200, `Content-Type: text/event-stream`, and emits an initial `retry:` directive within 1 second; an unauthenticated request returns 401 without opening a stream.
**Acceptance:** Test exists, runs, fails because the SSE controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 184 (GREEN): Implement SSE handshake step (headers + retry directive)
**Files:** `apps/api/src/console/live.controller.ts`
**What to do:** Set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; flush headers; write `retry: 3000\n\n`.
**Acceptance:** Task 183 passes.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 185 (RED): Failing test for `GET /console/live` emits initial badge state
**Files:** `apps/api/test/console/live.controller.test.ts`
**What to do:** Add a failing test naming the behavior: the first `data:` event on the stream is a payload validating against `LiveBadgeStateSchema` (initial badge state from `LiveBadgeService.state()`) so the client can render before any tick arrives.
**Acceptance:** Test exists, runs, fails because the initial-state emission is unimplemented.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 186 (GREEN): Implement initial badge state emission
**Files:** `apps/api/src/console/live.controller.ts`
**What to do:** After the handshake, call `LiveBadgeService.state()`, serialize, write `data: ${json}\n\n`.
**Acceptance:** Task 185 passes.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 187 (RED): Failing test for `GET /console/live` per-user subscription receives ticks
**Files:** `apps/api/test/console/live.controller.test.ts`
**What to do:** Add a failing test naming the behavior: while a user has an open SSE stream, publishing a tick for that user via the `SseHub` causes a `data:` line to be written to the stream within the debounce window; publishing a tick for a different user writes nothing to the first user's stream.
**Acceptance:** Test exists, runs, fails because the subscription wiring is unimplemented.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 188 (GREEN): Implement SseHub subscription
**Files:** `apps/api/src/console/live.controller.ts`
**What to do:** Call `sseHub.subscribe(userId, (tick) => res.write('data: ' + JSON.stringify(tick) + '\n\n'))`; hold the returned unsubscribe handle.
**Acceptance:** Task 187 passes.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 189 (RED): Failing test for `GET /console/live` unsubscribes on disconnect
**Files:** `apps/api/test/console/live.controller.test.ts`
**What to do:** Add a failing test naming the behavior: on stream disconnect (client closes), the subscription is removed from the hub (subsequent publishes for that user do not invoke any callback associated with the closed stream).
**Acceptance:** Test exists, runs, fails because the cleanup is unimplemented.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 190 (GREEN): Implement unsubscribe-on-disconnect
**Files:** `apps/api/src/console/live.controller.ts`
**What to do:** Register a `req.on('close', () => unsubscribe())` handler before returning the response object to Nest.
**Acceptance:** Task 189 passes.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 191 (RED): Failing test for `GET /console/live` keep-alive comment ping
**Files:** `apps/api/test/console/live.controller.test.ts`
**What to do:** Add a failing test using jest fake timers naming the behavior: at half the configured heartbeat cadence, the SSE stream writes a comment line (`: ping\n\n`) to keep the connection alive in front of intermediaries; the ping does not appear as a `data:` event.
**Acceptance:** Test exists, runs, fails because the keep-alive is unimplemented.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 192 (GREEN): Implement keep-alive ping
**Files:** `apps/api/src/console/live.controller.ts`
**What to do:** Arm a `setInterval` at `config.HEARTBEAT_INTERVAL_MS / 2` writing `: ping\n\n`; clear the interval in the close handler.
**Acceptance:** Task 191 passes; Task 189 still passes.
**Verify:** `pnpm --filter @argus/api test live.controller.test`

### Task 193: [non-TDD — Nest bootstrap glue] Register Phase B modules in `app.module.ts`
**Files:** `apps/api/src/app.module.ts`
**What to do:** Add `AutoModule`, `OrchestratorModule`, `ReplayModule`, `ConsoleModule`, `LiveEventsModule`, `HeartbeatModule`, `JanitorModule` to the root module imports.
**Acceptance:** `pnpm --filter @argus/api start` boots without missing-provider errors; `pnpm --filter @argus/api typecheck` reports zero errors.
**Verify:** `pnpm --filter @argus/api typecheck`

### Task 194 (RED): Failing test for `main.ts` lifecycle starts + stops Phase B services
**Files:** `apps/api/test/bootstrap/lifecycle.test.ts`
**What to do:** Write a failing test naming the behavior: a test harness that bootstraps the Nest app and asserts the janitor scheduler's `start()`, the heartbeat scheduler's `start()`, and the live-events consumer's `start()` were each called exactly once after `app.listen()`; sending a fake SIGTERM (via `process.emit('SIGTERM')` on a controlled subprocess or by directly invoking the registered hook) results in each service's `stop()` being called in reverse order before the app exits. Use jest spies on the three classes.
**Acceptance:** Test exists, runs, fails because the lifecycle glue is unimplemented.
**Verify:** `pnpm --filter @argus/api test lifecycle.test`

### Task 195 (GREEN): Wire lifecycle glue in `main.ts`
**Files:** `apps/api/src/main.ts`
**What to do:** After `app.listen()`, resolve the janitor scheduler, the heartbeat scheduler, and the `LiveEventsConsumer` from the Nest container and call their `start()` methods; register a `process.on('SIGTERM' | 'SIGINT')` handler that calls `stop()` on each in reverse order before `app.close()`.
**Acceptance:** Task 194 passes.
**Verify:** `pnpm --filter @argus/api test lifecycle.test`

### Task 196: [non-TDD — compose smoke] End-to-end SSE round trip
**Files:** N/A (manual smoke only — append a one-line entry to `docs/runbooks/smoke-tests.md` under a new "Phase B" section recording the date and outcome of the walkthrough; create the file if absent)
**What to do:** With compose up (api, workers, redpanda, postgres, otel-collector), authenticate as the demo user (`demo@argus.dev` / `let-me-in-9`) and capture the `session` cookie; open `/console/live` with `curl -N -H "Cookie: session=<value>"`, then in another shell send a chat turn via `wscat -c ws://localhost:3000/ws/chat -H "Cookie: session=<value>"` and emit the Phase A `send` frame (`{"type":"send","conversationId":"<id>","content":"hello","provider":"mock"}`). Observe the SSE stream emit one `data:` line carrying a tick whose `userId` matches the demo user and whose `kind` is `chat` within ~5 seconds of the chat turn's end frame.
**Acceptance:** SSE tick arrives within the 5s budget; no duplicate ticks for a single chat turn; killing the workers consumer interrupts the ticks but does not crash the SSE stream. Runbook entry appended.
**Verify:** Manual walk-through with `curl -N` + `wscat`; runbook diff committed.

### Task 197: [non-TDD — provider network smoke] Real-provider failover walkthrough
**Files:** N/A (manual smoke only — append a one-line entry to `docs/runbooks/smoke-tests.md` under the Phase B section)
**What to do:** With one real provider key set to an invalid value and the other two valid, send chat turns with each non-Auto provider selected; observe Traces showing the attempt chain with the broken provider's row carrying its error class and the next provider's row carrying the successful response; confirm Mock is never substituted in the chain. **Note:** the failover state machine itself is owned by `packages/sdk` and tested there; this smoke verifies the API correctly displays the attempt chain.
**Acceptance:** Three turns produce the expected attempt chains; the Traces tab shows the chains correctly. Runbook entry appended.
**Verify:** Manual walk-through against compose; runbook diff committed.

### Task 198: [non-TDD — live-badge transitions] Manual badge walkthrough
**Files:** N/A (manual smoke only — append a one-line entry to `docs/runbooks/smoke-tests.md` under the Phase B section)
**What to do:** With `/console` open in a browser, stop the heartbeat scheduler (kill the api), wait 35 seconds, observe the badge transition green → behind → error; restart the api, observe error → green; stop the workers consumer to artificially lag projection and observe green → behind while heartbeat rows accumulate behind the consumer.
**Acceptance:** All three transitions observed in order with the documented timings. Runbook entry appended.
**Verify:** Manual walk-through against compose; runbook diff committed.

## Quality Gates
- type-check: `pnpm --filter @argus/api typecheck`
- lint: `pnpm --filter @argus/api lint`
- test: `pnpm --filter @argus/api test`

## Dependencies
- `packages/db` Phase B migration `0002_phase_b_kind_enum` (kind enum, FKs, `sample_workspaces`, `user_clear_fences`, `sessions.current_sample_workspace_id`, `inferences.updated_at`, `trace_events.kind` + `trace_events.user_id` + supporting indices).
- `packages/sdk`: argus PR #4 (commit b181118) already provides the real `chat.stream` surface with failover (HLD Phase A §D3), OTel emission, and pricing. Phase B adds no SDK work — this LLD consumes the existing surface as-is, and the Auto router classifies by calling `chat.stream` against `gpt-4o-mini`.
- `packages/contracts` Phase B: `SseTick`, `LiveEventPayload`, console row + DTO schemas, `LiveBadgeState`, `OtelLlmKindAttribute`, `CONSOLE_LIVE_PATH`.
- `apps/workers` Phase B: kind routing, clear-fence enforcement, `live-events` publish-after-commit, `trace_events.user_id` population.

## Hand-Off Risk

- **Cross-LLD ordering:** This LLD assumes the `packages/db` migration lands first (Tasks 16, 19, 43, 61, 82, 97, 109, 116, 135, 145, 160 all reference fields/tables/columns that the migration introduces). The builder pauses if Prisma generated types do not include `inferences.kind` etc. and files a db-LLD task.
- **SDK failover ownership:** This LLD intentionally does NOT contain any failover state machine. The chat gateway and replay service consume the SDK chat surface with a `provider` hint and treat thrown `FailoverExhaustedError` as opaque. If the SDK LLD slips, the API tests using real SDK provider stubs will still pass — but the end-to-end smoke (Task 197) will fail until the SDK chain lands.
- **Trace events user scope:** `ClearService.execute`'s delete pass assumes `trace_events.user_id` exists and is populated by the projection consumer. If that field isn't populated yet, clear will silently leave trace events orphaned. The db-LLD prerequisite + workers-LLD population must both land before Task 120 can pass.
- **Phase A error envelope shape:** Task 163 references "Phase A's error envelope". The builder reads `apps/api/src/common/authorization.filter.ts` for the existing shape and matches it; if Phase A uses a default Nest filter, the builder uses the default and notes it in the PR description.
- **SSE debounce timer-vs-clock split:** Task 127 requires both jest fake timers (for `setTimeout`) and `FakeClock` (for the tick payload timestamps). The builder must NOT collapse these into one — fake timers control timer firing, FakeClock controls data inside the tick. Brittleness risk if either is omitted.
- **Module wiring smoke vs unit coverage:** Tasks 23, 31, 107, 133, 154, 158, 181 are deliberately Nest-testing-module RED tests rather than blanket `typecheck` checks. If the builder finds these too heavy, they may relabel as `[non-TDD — Nest DI wiring]` but only after confirming the module surface is too narrow to test meaningfully.

## Open Questions

- **Per-orchestrator SSE event for cross-tab `/chat` updates.** The SSE hub publishes per-user; if a `/console` tab is open in one browser and `/chat` in another, both will receive the tick and refetch. Documented as expected; no per-tab routing in Phase B.
- **Sparkline bucket size when window is `all-time`.** Per-hour buckets across an unbounded window can produce thousands of points. Default behavior: when window is `all-time` and total range exceeds 30 days, the sparkline helper downsamples to per-day buckets. Documented; if reviewer wants finer control, the bucket size becomes a config knob in a follow-up.
- **Janitor sweep behavior when DB is briefly unreachable.** Sweep failure is captured via `captureApiError({ feature: 'janitor', layer: 'service' })` and the next interval retries; the scheduler does not back off. Acceptable for a single-replica demo.
- **Live badge is global vs per-user.** Decided global (single ingestion-health signal across all users) per Task 135's note. If product later wants per-user badges, the query gains a `user_id` filter and the badge service takes a user id arg; documented as a future change.

## Reviewer Concerns

Codex v2 review (5/10) surfaced these unresolved items after 2 review iterations per /oh discipline. Builder absorbs during execution:

- **2 schema/type shape definitions remain in plan text** — `LiveBadgeStateSchema { state, lagSeconds?, message? }` and the `sample_workspaces` table column list. These belong in `packages/contracts` / db LLD. Replace with prose when touching those sections. (The former `sdkChat.classify` signature concern is resolved: classification now reuses the existing `chat.stream` surface, and category parsing is owned by the classifier adapter — no SDK type shape lives in this plan.)
- **3 tasks still mildly oversized** (0c fixture extension, 181 ConsoleModule wiring, 194 lifecycle glue in main.ts) — split during execution.
- **Prisma delegate naming consistency** — some tasks use `traceEvent.deleteMany`, others `traceEvents.deleteMany`. Prisma generates singular delegates by default. Pin to singular (`traceEvent` / `sampleWorkspace` / `userClearFence`); db LLD is the source of truth, verify post-migration.
- **In-memory Prisma fixture risk** — Task 0c extends `createInMemoryPrisma()` to support filters, aggregates, transactions, cursors, deletes. Verging on a parallel DB implementation. If load-bearing for repository/aggregate tests, switch those tests to the testcontainer pattern Phase A workers use.
- **Aggregates SQL portability** — `date_trunc('hour', ...)` and grouped SUM with CASE missing-pricing logic (Task 56) are SQL-shaped. The in-memory fixture can't execute these natively. Use raw Prisma `$queryRaw` with testcontainer-only tests, OR implement portable TS aggregation.
- **Lifecycle signal-testing brittleness** (Tasks 194-195) — SIGTERM tests against `main.ts` directly are flaky. Extract lifecycle start/stop into a testable function; have `main.ts` call it. Test the function.
- **`SDK provider token` and `config` not named** (Task 25) — module-wiring acceptance assumes these tokens exist. Reference exact Phase A token names or add "pause if absent" rule.
- **Missing tests for janitor + heartbeat failure capture** — Open Questions mention `captureApiError({ feature: 'janitor', layer: 'service' })` on DB-unreachable sweep, but no RED test verifies. Heartbeat scheduler likewise — if span emission throws, should the interval continue or crash? Decide and add a one-pair test.
- **ReplayService cross-user source rejection** — controller-level only currently; the service should reject cross-user source ids too (defense in depth). Add a single service-level test.
- **`pnpm --filter @argus/api install` is wrong** — pnpm install runs workspace-wide. Use `pnpm install` from root, then `pnpm --filter @argus/api typecheck`.
