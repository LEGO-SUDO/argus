## 0. Format Violations

Hard rejection on test detail and task sizing.

> “Add a failing integration test with three observable assertions:
> - (a) Order...
> - (b) DB failure...
> - (c) Duplicate redelivery...”

Task 31 is too large and contains detailed test assertions. Split into three RED tasks, each with one GREEN/wiring task or one shared GREEN immediately after.

> “RED half — write a failing unit test... The test covers: (i) ... (ii) ... (iii) ...  
> GREEN half — implement the publisher...”

Task 32 combines RED and GREEN in one task and is well over 5 minutes. Split into separate RED/GREEN pairs for send shape, error swallowing, and lifecycle.

> “Task 35 ... Assert that the resulting `inferences` row has kind sample... Add a sibling assertion...”

This is detailed test implementation. Keep behavior-level prose, move exact row assertions into the test file.

> “Task 13 (GREEN) ... The cascade half of Task 12 passes; the SET NULL half remains failing until Task 16 lands and is acceptable in the interim.”

A GREEN task must not knowingly leave its paired RED test failing. Split Task 12 into cascade RED and session-pointer RED, or move the session assertion entirely to Task 16.

> “Task 3 (GREEN): No-code task — confirm contracts already satisfy snake_case OR escalate”

This is a non-code gate, not a GREEN implementation. Add `[non-TDD — contracts dependency gate]` or fold into Task 0/2.

> “Task 1a”, “Task 5”, “Task 15”, “Task 31”, “Task 32”, “Task 39c”

These are not bite-sized. Each likely exceeds 5 minutes because they combine harnessing, schema generation, multiple assertions, integration wiring, or end-to-end smoke scripting. Split.

## 1. Tasks That Are Too Vague To Execute

> “Create a db-local Postgres testcontainer helper modeled on `apps/workers/test/helpers/integration-env.ts`... runs `prisma migrate deploy`”

Ambiguous because the existing worker helper applies raw migration SQL directly, not `prisma migrate deploy`. The builder needs to know whether db tests should shell out to Prisma CLI with `DATABASE_URL`, or reuse the raw SQL migration approach.

> “Add `testcontainers` (matching workers' pinned version) to devDependencies.”

The planned helper uses `PostgreSqlContainer`, which in this repo comes from `@testcontainers/postgresql`, not only `testcontainers`. Add both deps explicitly.

> “assert via call-order spy that the publish call happens AFTER the prisma transaction callback resolves.”

This is hard to implement reliably. The builder needs an expected seam: mock `$transaction`, fake publisher, or instrument a callback boundary. As written, they may write a brittle test against Prisma internals.

> “Constructor takes a kafkajs `Kafka` client created from env-driven `REDPANDA_BROKERS`.”

Contradictory: either the constructor takes an injected `Kafka`, or the class constructs it from env. Define the DI shape.

> “POST one synthetic OTLP span carrying `llm.kind=chat` to the OTel Collector OTLP endpoint.”

Not executable enough. The LLD must name the endpoint, content type, payload encoding expected by this repo, and how the span reaches the workers topic.

## 2. Missing Acceptance Criteria

> “No changes to `src/index.ts` — existing PrismaClient export and re-exports cover the new types automatically.”

This is false for the current repo. [packages/db/src/index.ts](/Users/lego/Desktop/personal-projects/chatapp/packages/db/src/index.ts:25) explicitly exports a fixed type list. If builders need `InferenceKind` from `@argus/db`, acceptance must include exporting it.

> “Add three indexes on the three new columns since they are Phase B query filter columns.”

No test verifies those indexes. Add RED schema tests for indexes on `classifier_for_message_id`, `replay_of_inference_id`, and `sample_workspace_id`.

> “Phase B write payload includes the four new columns”

Task 35 only verifies `kind` and `sample_workspace_id`. It does not verify `classifier_for_message_id` or `replay_of_inference_id` are actually written by `ProjectionService`.

## 3. Test Gaps

Heartbeat idempotency is under-specified. Current idempotency depends on `trace_events`, but current mapper creates trace events only from `span.events`. Heartbeat spans often have no events. The LLD says:

> “No change to the consumer's idempotency code path”

and later:

> “fabricates a burst of OTLP spans with `llm.kind=heartbeat`... duplicate redelivery”

Add a test or design requirement for zero-event spans. Either heartbeat spans must carry at least one event, or the consumer must create a trace-event audit row per span even when `span.events` is empty.

Clear-fence drop is tested for no DB rows, but not “no publish.” Task 30 says no live-events publish, but Task 29 acceptance only mentions rows / log line. Add publish spy assertion.

Publisher integration does not test payload casing at the service boundary. Unit tests cover publisher shape, but `ProjectionService` could still pass camelCase unless the service-level spy asserts snake_case.

No migration test verifies enum values exactly. Task 4 checks type/default, but not that the enum contains exactly `chat | classifier | replay | sample | heartbeat | unknown`.

No schema test verifies `updated_at DEFAULT CURRENT_TIMESTAMP` for existing-row backfill, only Prisma ticking.

## 4. File-Path Errors

> “`packages/db/jest.config.ts` (new file)”

The repo uses CommonJS Jest configs (`apps/workers/jest.config.js`, `apps/api/jest.config.js`, `apps/web/jest.config.js`). `packages/db` does not have `ts-node`, so `jest.config.ts` is likely not loadable. Use `packages/db/jest.config.js`.

> “`packages/contracts/__tests__/sse.test.ts`”

`packages/contracts` currently has no Jest config. Its `test` script is just `jest --passWithNoTests`, and without ts-jest config, a TypeScript test under `__tests__` will likely fail to parse. Add `packages/contracts/jest.config.js` or place/configure tests consistently.

> “`apps/workers/README.md`”

This file does not exist in the current repo. Task 40 should say create it, or document in root [README.md](/Users/lego/Desktop/personal-projects/chatapp/README.md:1).

> “Verify: `pnpm --filter @argus/contracts test __tests__/sse.test.ts`”

Given no contracts Jest config, this verify command is not currently meaningful.

## 5. Hand-Off Risk

The ProjectionModule currently constructs the service manually:

> `useFactory: () => new ProjectionService(prisma)`

Task 33 says “Inject the publisher into ProjectionService,” but does not warn that the existing factory bypasses Nest dependency injection. Builder may add a constructor param and forget to update the factory/provider wiring.

The plan says:

> “The publisher catches its own kafkajs `send` errors internally”

but also:

> “the call IS awaited (so any synchronous publisher failure surfaces in the same batch)”

If publisher catches all errors, synchronous failures inside `publish` may not surface. Clarify which failures are swallowed and which are allowed through.

Task 0 says contracts must expose individual symbols:

> `LLM_KIND, LLM_SAMPLE_WORKSPACE_ID...`

Current contracts use the `OTEL_ATTRS` object pattern. If the contracts workstream follows existing style and adds keys to `OTEL_ATTRS` only, this LLD blocks unnecessarily. Decide whether individual exports are truly required.

Prisma enum naming needs care. Existing DB enums are `"MessageStatus"` / `"InferenceStatus"`, while this plan requires DB type `inference_kind`. Good requirement, but the builder must verify Prisma actually emits the mapped enum type, not just the TS enum name.

The schema plan adds `SampleWorkspace` and `UserClearFence` but does not mention adding back-relations on `User`; Prisma will require/benefit from them depending relation declaration style. Call it out explicitly.

## 6. Quality Score

5/10.

The design intent is strong and most risks are identified, but the handoff is not ready: several tasks violate the plan format, multiple tasks are too large, Jest/package config is wrong for the current repo, one GREEN intentionally leaves tests failing, and the heartbeat idempotency path has a real design gap for zero-event spans.
