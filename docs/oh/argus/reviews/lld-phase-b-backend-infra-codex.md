## 0. Format violations (rejection criteria — flag FIRST)

- Offending: `checkClearFence(prisma, userId, spanStartedAt)` and `LiveEventsPublisher.publish({ userId, kind, conversationId })`
  
  These are function signatures / call shapes. Replace with prose I/O descriptions, e.g. “the helper accepts a Prisma client, user id, and span start time.”

- Offending: many tasks spell out exact assertions, for example:
  
  > `Assert: zero trace_events rows created, zero inferences rows created...`
  
  > `Assert: exactly 100 trace_events rows + 100 inferences rows...`
  
  The LLD is too close to test implementation. Keep behavior-level acceptance, move exact assertions into tests.

- Offending:
  
  > `Task 25 (RED)... Acceptance: Case may pass immediately...`
  
  > `Task 30 (RED)... Acceptance: Case fails if... or passes immediately...`
  
  > `Task 32 (RED)... Case fails until Tasks 16/18/20 are landed`
  
  These are not real RED tasks. A RED task must fail for the behavior under construction and pair with a GREEN task. Reclassify as regression tests or move them after implementation as non-TDD verification, or restructure so each has a concrete failing precondition.

- Offending:
  
  > `Task 34: [non-TDD — module wiring] Register LiveEventsPublisher in ProjectionModule`
  
  This duplicates Task 29, which already says:
  
  > `Register LiveEventsPublisher as a provider in ProjectionModule.`
  
  Delete Task 34 or remove the module-registration work from Task 29.

- Offending:
  
  > `Task 37: [non-TDD — end-to-end smoke RUN] Produce a span, observe live-events tick`
  
  This is much larger than a bite-sized task and depends on compose, worker runtime, OTLP payload construction, Kafka consumption, and DB verification. Split into smaller smoke tasks or make it a PR validation checklist outside the builder task plan.

- Offending:
  
  > `Task 1... uses the existing Prisma testcontainer pattern from Phase A's workers test helpers, adapted for the db package — author the adaptation in this task`
  
  This is likely >5 minutes and bundles test-helper infrastructure with the schema test. Split into a non-TDD test-harness setup task plus the RED schema test.

## 1. Tasks that are too vague to execute

- Quote:
  
  > `Prisma-generated then committed`
  
  Ambiguous because the workspace may not have a live Postgres available, and migration numbering is already known to be collision-prone. The builder needs exact migration naming rules: inspect existing migrations and choose the next numeric prefix.

- Quote:
  
  > `existing Prisma testcontainer pattern from Phase A's workers test helpers, adapted for the db package`
  
  This assumes a helper exists and is portable. The LLD should name the helper path and define whether db package tests may import from workers, copy a helper, or create a db-local helper.

- Quote:
  
  > `mapping unrecognized llm.kind values to unknown ... emits an OTel log line`
  
  “OTel log line” is ambiguous in a Nest worker. The LLD later says `logger.warn`. Pick one concrete logging mechanism already used by the app.

- Quote:
  
  > `captures the error with Sentry recoverable=yes`
  
  The LLD references `captureProjectionError` but does not confirm the available function shape or allowed layer values. Builder needs the exact existing error helper contract or a task to extend it.

- Quote:
  
  > `assert both produce the same shape of (inferences, trace_events) write`
  
  This is vague and brittle. Tests cannot reliably prove “same code path” without invasive instrumentation. Test observable persistence behavior only.

## 2. Missing acceptance criteria

Most tasks include acceptance and verify commands, but several are weak:

- Task 0 acceptance says:
  
  > `grep ... returns at least six matches`
  
  This can pass if all symbols appear in comments or non-exported imports. Acceptance should require exported public symbols.

- Task 18 acceptance does not verify the unknown-kind log:
  
  > `Tasks 15 and 17 cases all pass`
  
  Add acceptance that the structured unknown-kind log is emitted with the raw value.

- Task 27 acceptance does not verify lifecycle hooks:
  
  > `Task 26 cases pass`
  
  Add observable acceptance for connect on module init and disconnect on destroy, or remove lifecycle details from the task.

- Task 35 acceptance:
  
  > `Read of topics.sh shows two rpk topic create invocations`
  
  This is weaker than behavior. It should verify env override names are honored and rerun idempotency is preserved.

## 3. Test gaps

- Migration enum naming is internally inconsistent and needs a test. Task 1 expects `udt_name inference_kind`, while Task 2 says:
  
  > `migration must declare a new enum type named InferenceKind`
  
  These cannot both be true in Postgres catalog terms. The test should assert the actual intended DB enum type name and the migration task should match it.

- No test covers FK delete behavior:
  
  > `sample_workspaces.user_id FK to users with cascade-on-delete`
  
  > `sessions.current_sample_workspace_id ... onDelete: SetNull`
  
  These are important semantics and should have schema/integration assertions.

- No test covers invalid FK attributes from spans. If `sample_workspace_id` or replay/classifier ids are malformed UUIDs or point to missing rows, the projection could fail after trace idempotency. The LLD should define whether to drop, write null, map to unknown, or let the transaction fail.

- No test covers duplicate span + live-event behavior. The post-commit publisher could emit a live-event on duplicate redelivery even if no new inference was written. The idempotency regression checks row counts but not publish count.

- No test covers default `kind=chat` at the DB write path when the mapper omits or defaults the value. Mapper unit tests are not enough; the create/update payload wiring could still miss `kind`.

- No test verifies `LiveEventsPayload` field naming against contracts. The LLD says HLD payload is `{ user_id, kind, conversation_id }`, but Task 27 uses `{ userId, kind, conversationId }`. This needs one contract-backed test and a settled naming convention.

## 4. File-path errors

Potential issues to verify before handoff:

- `packages/db/test/schema-phase-b.test.ts`: the repo may not currently have db package tests or testcontainer wiring. The LLD admits this must be adapted but does not give an existing db convention.

- `apps/workers/test/helpers/prisma-testcontainer.ts`: referenced as existing. If it is Phase A worktree-only or not merged, this path may not exist.

- `apps/workers/src/projection/projection.module.ts`: Task 29 and Task 34 both modify this file for the same provider registration.

- Migration name:
  
  > `0002_phase_b_kind_enum`
  
  Later concern says Phase A already has `0002_inference_trace_index`. The primary plan should not name a colliding migration. Use “next available migration number” throughout, not just in a reviewer concern.

## 5. Hand-off risk

- The Prisma enum mapping is the biggest risk. The LLD mixes Prisma enum name, SQL enum type name, and mapped DB name. Builder may generate a migration that fails the test or vice versa.

- `@updatedAt` semantics are overstated. Prisma `@updatedAt` is client-managed, not a database trigger. A raw SQL update will not tick it. Task 13 must update through Prisma if the requirement is Prisma semantics, or the migration must add a DB trigger if DB-level semantics are required.

- Clear-fence ordering before trace idempotency is intentional, but it means old duplicate spans after a clear produce no trace_event audit row. That may be fine, but the LLD should explicitly confirm this tradeoff.

- Live-events publish “fire-and-forget” conflicts with:
  
  > `The call is awaited`
  
  Choose wording. The intended behavior appears to be awaited call after commit, with internal error swallowing.

- Task 0 blocks on contracts but this LLD also defines DB enum values and payload field names. If contracts disagree, the builder has no instruction for reconciling except “stop.” That is acceptable, but the LLD should say every later task depends on Task 0 passing, not only “before Task 15.”

- Redpanda topic env overrides may not match existing naming style. The LLD should tell builder to mirror the actual `traces` variables found in `topics.sh`, not assume names.

- The plan is overlong and too sequential. Many schema RED/GREEN pairs amend the same migration repeatedly. That creates churn and increases the chance of a bad generated migration. Better: one RED schema suite covering all Phase B schema, one GREEN schema/migration task.

## 6. Quality score

5/10.

The design intent is clear and covers many important risks, but the task plan violates its own format rules in several places, has real Prisma/DB semantic ambiguity, duplicates work, and includes several “RED” tasks that may pass immediately. I would revise before handing this to a builder.
