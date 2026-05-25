## 0. Format Violations

Hard rejection items exist.

- **Type / schema definitions in the plan**

  > `LiveBadgeStateSchema` — `{ state: 'live' | 'behind' | 'error', lagSeconds?: number, message?: string }`.

  This is a type shape. Keep the dependency prose, but move concrete schema shape to `packages/contracts`.

- **SQL/table-shape definitions in the plan**

  > `sample_workspaces` table — `(id PK, user_id FK→users.id ON DELETE CASCADE, created_at DEFAULT now())`.

  > `user_clear_fences` table — `(user_id PK FK→users.id ON DELETE CASCADE, clear_after_ts NOT NULL)`.

  These are schema definitions. The API LLD should reference the db LLD contract, not restate table definitions in SQL-ish form.

- **Function signatures / API signatures**

  > `sdkChat.classify({ message, model })` — returns a `Promise<{ category, providerMeta, traceContext }>`

  This is a concrete interface definition. Move it to contracts/sdk LLD and keep this LLD at “consume SDK classifier surface”.

- **Detailed implementation recipe inside a GREEN task**

  > `Implement the documented ordering exactly: 1. Open Prisma transaction. 2. Upsert fence row...`

  Task 123 is more implementation-script than LLD task. Keep the ordering requirement, but reduce the step-by-step code choreography or split into smaller RED/GREEN tasks.

- **Tasks too large for the stated bite-sized standard**

  > Task 0c: Extend `prisma-test-client` with Phase B columns and tables

  This touches multiple models, CRUD surfaces, aggregates, deletes, and defaults. It is not a 5-minute task. Split by model/surface.

  > Task 181: Wire `ConsoleModule`

  This wires controllers, repositories, auth, replay, chat, SDK, Prisma, and services. Split into smaller module wiring tasks or make it a clearly labeled non-TDD integration wiring task.

  > Task 194: Wire lifecycle glue in `main.ts`

  Includes post-listen start, signal handling, reverse-order shutdown, and app close. Split start and shutdown behavior.

## 1. Tasks Too Vague To Execute

- > Task 24: expects `PrismaService`, the SDK provider token, and the config to be available in the importing module's scope

  “SDK provider token” and “config” are not named. Builder needs exact provider tokens/imports or an explicit “pause if absent” rule.

- > Task 55: Implement bucketization at `date_trunc('hour', started_at)` ... left-join against a generated bucket series

  This assumes SQL capabilities, but the fixture is in-memory Prisma. Builder needs guidance on whether implementation should use raw SQL in production and separate in-memory logic in tests, or a portable TypeScript aggregation.

- > Task 111: loop over N prompts kicking off orchestrator runs against Mock

  “Kicking off orchestrator runs” is underspecified. Should this call `ChatService.startTurn`, instantiate `StreamOrchestrator`, register handles, and fire-and-forget like replay? It needs the exact orchestration boundary.

- > Task 193: sending a fake SIGTERM ... on a controlled subprocess or by directly invoking the registered hook

  This gives two very different test strategies. Pick one. Signal tests are brittle unless the bootstrap exports a testable lifecycle function.

- > Task 195: emit the Phase A `send` frame (`{"type":"send","conversationId":"<id>","content":"hello","provider":"mock"}`)

  It does not say how to obtain or create `<id>`. Builder needs the setup path.

## 2. Missing Acceptance Criteria

Most tasks have acceptance criteria, but some are not observable enough.

- > Task 179: Confirm by inspection

  Acceptance depends on inspection, not behavior. The paired RED test covers it, so acceptance should say “Task 178 passes.”

- > Task 147 / 149 / 152: “Verify the predicate...”

  These GREEN tasks are confirmation tasks, not implementation tasks. They are acceptable only if the RED tests fail first. Better: merge each into the original GREEN implementation or state what exact code change is required if failing.

## 3. Test Gaps

- **Auto router does not test provider/model handoff into `ChatService.startTurn`.**  
  Gateway tests check provider passed to orchestrator, but classifier linkage also needs to reach the placeholder insert via `classifierMessageId`.

- **Classifier adapter success path lacks failure-status/cost/token fields clarity.**  
  It says persist `status='ok'`, provider/model, kind, FK. It does not test timestamps, user scope, conversation/message linkage, or trace context handling.

- **ClearService tests do not cover projection clear-fence interaction.**  
  The LLD depends on workers enforcing fences, but API tests only delete existing rows. At least one contract-level test or smoke note should verify events after fence are not reinserted.

- **SSE error handling is under-tested.**  
  `LiveController` does not mention handling `res.write` failures, badge service failures during initial state, or subscriber callback exceptions.

- **Config tests do not cover negative/zero millisecond values.**  
  Invalid non-integer is covered, but `0`, negative values, and empty strings should be specified for cadence/threshold envs.

- **Janitor failure capture is mentioned in Open Questions but not tested.**  
  There is no RED/GREEN task for DB unreachable during sweep calling `captureApiError({ feature: 'janitor', layer: 'service' })`.

- **Heartbeat scheduler failure behavior is not tested.**  
  If span emission throws, should the scheduler capture and continue or crash the interval?

- **Replay run source ownership is mostly controller-level.**  
  `ReplayService.run` itself should reject cross-user source ids, not rely only on controller behavior.

## 4. File-Path Errors / Inconsistencies

- > `traceEvent.{create,findMany,deleteMany,aggregate}`

  Later tasks use:

  > `traceEvents.deleteMany`

  Pick one Prisma delegate name. Prisma usually generates singular model delegates, e.g. `traceEvent`, unless the model is named `TraceEvents`.

- > `sampleWorkspace.{create,findFirst,findMany,delete}`

  Later text refers to table `sample_workspaces`. The Prisma delegate name must be pinned from the db LLD.

- > `userClearFence.{upsert,findUnique,delete}`

  Same issue: make sure this matches the Prisma model name.

- > `pnpm --filter @argus/api install`

  This is likely wrong. `pnpm install` is normally workspace-root only; filtered install is not usually the command. Use `pnpm install` then `pnpm --filter @argus/api typecheck`.

- > `apps/api/src/console/sse-event.ts` — value type for the SSE tick payload

  This duplicates contracts ownership. If the shape lives in contracts, this file should only be an encoder/helper, not a value type.

## 5. Hand-Off Risk

- The LLD is very long and mixes API work, fixture work, module wiring, lifecycle, manual smoke, and cross-package contracts. A builder will likely lose ordering discipline. Split this into smaller handoffs: common/config, auto/router, console reads, replay, live/SSE, janitor/heartbeat, bootstrap.

- The “pause if db fields missing” rule is good, but many tasks still instruct implementation against those fields. Put the db generated-type check as an explicit first blocking task before any RED tests that depend on the new schema.

- The in-memory Prisma fixture is a major risk. It is asked to emulate enough Prisma behavior for filters, aggregates, transactions, cursors, and deletes. That can become a parallel database implementation. Prefer real test DB for repository/aggregate tests or heavily constrain the fixture behavior.

- The aggregates design conflicts with Prisma portability. `date_trunc`, generated series, grouped SUMs, and missing-pricing CASE logic are SQL-shaped but tests target an in-memory fixture.

- Lifecycle testing via real process signals can destabilize the test suite. Extract lifecycle start/stop orchestration into a testable function and have `main.ts` call it.

- Fire-and-forget orchestrator runs need explicit error capture rules. Several services start work asynchronously, but the LLD does not consistently say where rejected promises go.

## 6. Quality Score

**5/10**

The plan is comprehensive and mostly well ordered, but it violates the no-type/no-schema-detail rule, contains several oversized tasks, and leaves high-risk implementation boundaries vague. It needs revision before handoff.
