## 0. Format Violations

No code blocks or code dumps found.

Hard rejection items:

- “**Tasks that aren't bite-sized (>5 minutes of worker time)**”

  Offending examples:
  - “Task 37 (GREEN): Implement failover state machine”
  - “Task 50 (GREEN): Implement `Aggregates` helper”
  - “Task 57 (GREEN): Implement `TracesRepository`”
  - “Task 77 (GREEN): Implement `ReplayService.run`”
  - “Task 119 (GREEN): Implement `ConsoleController` REST handlers”
  - “Task 124 (GREEN): Implement `LiveController` SSE handler”

  These are multi-hour implementation tasks, not bite-sized builder steps. Split into smaller RED/GREEN slices by behavior, especially controller/repository/service methods and edge cases.

- “Testable behavior NOT structured as a `RED → GREEN` task pair”

  Offending examples:
  - “Task 21 (GREEN): Wire `AutoModule`”
  - “Task 27 (GREEN): Wire `OrchestratorModule`”
  - “Task 78 (GREEN): Wire `ReplayModule`”
  - “Task 107 (GREEN): Wire `JanitorModule` with scheduler”
  - “Task 110 (GREEN): Wire `HeartbeatModule` with scheduler”
  - “Task 120 (GREEN): Wire `ConsoleModule`”

  These are testable DI behaviors but have no RED task. Either add failing module-instantiation tests first or relabel as `[non-TDD — Nest DI wiring]`.

- “Non-TDD tasks missing the `[non-TDD — <reason>]` label”

  Same module wiring tasks above are effectively non-TDD but not labeled. Add the label or add RED tests.

- “Tasks missing any of: file paths…”

  Offending lines:
  - “Task 127: [non-TDD — compose smoke] End-to-end SSE round trip”
  - “Files: none”
  - “Task 128: [non-TDD — provider network smoke] Real-provider failover walkthrough”
  - “Files: none”
  - “Task 129: [non-TDD — live-badge transitions] Manual badge walkthrough”
  - “Files: none”

  The format requires file paths. If truly manual, use “Files: N/A (manual smoke only)” and make that explicit in the format rules, or attach the relevant docs/runbook path to be updated.

## 1. Tasks That Are Too Vague To Execute

- “Wire `AutoModule` … importing the SDK provider, the Prisma service, and the config.”

  There is no existing SDK provider or Prisma service in the repo. The LLD does not say whether the builder should create Nest wrappers for `@argus/sdk` and `@argus/db`, or consume providers from another LLD. An engineer needs the actual provider tokens/import names.

- “The thrown error is captured to Sentry…”

  Appears in AutoRouter, registry, live-events, live-badge, janitor discussion. No Sentry package, module, token, or capture helper is specified. The builder will invent different capture mechanisms.

- “Use the Postgres fixture”

  Repeated across many tests, but the repo currently has no API test fixture, no Prisma models, and no test database setup. The LLD needs the fixture path/API or must depend on an infra/test-fixture LLD.

- “Chat outbox”, “StreamOrchestrator”, “Phase A controller error conventions”, “SessionGuard”

  These are referenced as existing contracts:
  - “writes happen via the chat outbox”
  - “construct + register a `StreamOrchestrator`”
  - “guarded by `SessionGuard`”
  - “map domain errors per Phase A's controller error conventions”

  None exist in the current API tree. The LLD needs to either declare them as hard prerequisites or include the exact files/interfaces from Phase A.

- “ClearService.execute … deletes user's `inferences` + `trace_events`”

  It does not define how `trace_events` are user-scoped. If trace events only link through inference/conversation, the delete predicate is non-trivial. The builder needs the schema relationship.

## 2. Missing Acceptance Criteria

- Task 21, 27, 78, 107, 110, 120 mostly say “module instantiates” or “typecheck”. That is weak unless paired with explicit Nest testing module coverage. Add observable tests or mark as non-TDD wiring.

- Task 126 acceptance says:
  - “starting the api logs janitor + heartbeat + live-events consumer start”
  - “killing with SIGTERM logs each `stop()`”

  The LLD does not require those classes to log anything. Either require logging in the implementation tasks or change acceptance to observable method calls in a smoke test.

- Task 127 acceptance says:
  - “SSE tick arrives within the 5s budget”

  It does not specify the exact auth cookie source, demo user id, wscat frame shape, or expected SSE payload schema. Manual acceptance is under-specified.

## 3. Test Gaps

- Config tests do not mention boolean/optional env handling for OpenAI key presence, yet AutoRouter depends on “OpenAI key configured”. Add tests for the config field that drives Auto routing.

- Failover tests omit provider attempt trace persistence. The manual smoke says traces should show attempt chains, but the RED/GREEN tests only verify the in-memory attempts list.

- Clear tests do not cover projection consumer clear-fence interaction. The LLD depends on workers enforcing fences, but API clear should probably test fence monotonicity and deletion race behavior around `fence` timestamps more precisely.

- SSE hub debounce test says “using the `FakeClock`”, but implementation uses `setTimeout`. A fake wall clock alone cannot advance Node timers unless the test also uses fake timers. Add explicit fake-timer requirement.

- Live badge tests cover heartbeat rows but not user scope. The service query is described as `MAX(trace_events.created_at) WHERE kind='heartbeat'`, global. If badge is global ingestion health, say so. If per-user, tests are missing.

- Replay reconstruction tests do not pin exact history boundary: “history-up-to-turn” should test exclusion of messages after the source turn and inclusion/exclusion of the triggering user message.

- Controller tests are broad but do not test `GET /console/live` route collision with the REST controller, which the file structure currently risks.

## 4. File-Path Errors

- The current repo only has:
  - `apps/api/src/app.module.ts`
  - `apps/api/src/main.ts`

  Paths like these do not exist yet:
  - `apps/api/src/chat/chat.gateway.ts`
  - `apps/api/src/chat/chat.service.ts`
  - `apps/api/src/auth/...`
  - `apps/api/test/...`

  That is not automatically wrong for a build plan, but the LLD treats several Phase A files as existing extension points. Add Phase A as an explicit prerequisite and tell the builder to pause if those files are absent.

- Duplicate route ownership:
  - “`apps/api/src/console/console.controller.ts` — REST handlers: … `GET /console/live` (SSE).”
  - “`apps/api/src/console/live.controller.ts` — dedicated SSE handler exposing `GET /console/live`”

  Only `live.controller.ts` should own `GET /console/live`. Remove it from `console.controller.ts`.

- `apps/api/package.json` currently lacks dependencies implied by the LLD:
  - `zod` direct dependency for config/controller parsing
  - `kafkajs`
  - `diff` / `jsdiff`
  - Sentry package
  - OpenTelemetry API package
  - WebSocket/SSE test dependencies like `supertest` if controller tests use it

  Add dependency tasks or move them to the relevant package LLDs.

## 5. Hand-Off Risk

- The plan depends heavily on `packages/db`, `packages/contracts`, `packages/sdk`, and `apps/workers` Phase B, but the current local package files are stubs. The builder is likely to invent interim schemas and SDK shapes despite the “pause” instruction, because many API tasks cannot compile without them.

- There is a contradiction around failover ownership:
  - Cross-dependency says “failover wiring is wholly inside the SDK per HLD D3 of Phase A.”
  - This LLD adds `apps/api/src/chat/failover.ts` implementing the failover state machine.

  Decide whether failover lives in SDK or API. Right now two builders could implement competing chains.

- Auto classifier failure behavior conflicts with earlier summary:
  - File Structure says “classify error → retry-or-terminate” under failover.
  - Task 19 says classifier adapter throw falls back to heuristic and does not surface.

  Clarify classifier errors are not part of provider failover and always fall back to heuristic.

- `ClearService.execute` ordering is risky:
  - Task 83 writes fence.
  - Task 84 says cancel runs before delete.
  - Task 87 says “upsert the fence, call `registry.cancelAll`, in a single transaction count + delete…”

  If cancellation emits terminal writes after the fence is written but before delete, race behavior needs to be explicit.

- `SseHub` design says “using the `Clock` and config debounce”, but timers require a scheduler/timer abstraction, not just a clock. Otherwise deterministic tests will be brittle.

- The janitor task says sweep “classifier or heartbeat row is never `status='streaming'` so the sweep's predicate finds none”, but the implementation predicate is only `status='streaming' AND updated_at < threshold`. If bad data has classifier/heartbeat streaming rows, they will be swept. Either accept that or add a `kind IN ('chat','replay','sample')` predicate.

## 6. Quality Score

5/10.

The LLD is comprehensive and mostly well structured, but it is not ready to hand off. The biggest blockers are oversized GREEN tasks, missing RED pairs for wiring, route ownership conflict, unclear prerequisite surfaces, and dependency mismatch with the current repo.
