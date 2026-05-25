---
phase: lld
status: APPROVED
revision: 4
slug: argus
scope: phase-b
workstream: backend-infra
builder: backend-infra-worker
reviewer: oh-cross-model --model codex
tester: oh-cross-model --model codex
created: 2026-05-25
updated: 2026-05-25
---

# LLD: backend-infra — Argus Chatbot Phase B (Control Plane)

Scope of this LLD: the ingestion-and-persistence extensions required by Phase B's `/console` reads, plus the new post-commit live-events publisher. Specifically:

- Prisma migration `0003_phase_b_kind_enum` that adds the `kind` enum column to `inferences` (`chat | classifier | replay | sample | heartbeat | unknown`, default `chat`), three new FKs on `inferences` (`classifier_for_message_id` → messages, `replay_of_inference_id` self-FK, `sample_workspace_id` → sample_workspaces), the `current_sample_workspace_id` pointer on `sessions`, two new tables (`sample_workspaces`, `user_clear_fences`), the supporting indexes, and adds the `updated_at` column on `inferences` that the janitor predicate (HLD D9) and the api stream-progress tick rely on. The same migration also DROPs the existing `trace_events` `UNIQUE(trace_id, span_id)` constraint and ADDs `UNIQUE(trace_id, span_id, name)` so a single span can persist multiple named events (e.g. `llm.input` + `llm.output`) on first delivery while preserving redelivery idempotency (a redelivered span repeats identical tuples and still hits P2002 on its first event).
- Projection consumer extensions in `apps/workers/src/projection/`: (a) `span-mapper.ts` reads `llm.kind`, `llm.sample_workspace_id`, `llm.replay_of_inference_id`, `llm.classifier_for_message_id` from span attributes and writes them to the corresponding `inferences` columns, mapping unrecognized `llm.kind` values to `unknown` (HLD §Regression Risk + §Forward-Compat Locks); (b) a new clear-fence enforcement step in `projection.service.ts` that drops spans where `span.startedAt < user.clearAfterTs`; (c) a new `live-events` publisher invoked AFTER each successful Postgres commit (HLD D3), with snake_case payload fields per the contract.
- Infra: a new Kafka topic `live-events` added to the Redpanda bootstrap script. NO new compose services — Redis remains deferred (HLD §Component Map).
- Heartbeat ingestion path: regression-test that the `(trace_id, span_id, name)` unique index (widened in migration `0003`) continues to dedupe high-frequency heartbeat spans (HLD §Regression Risk); the dedup still holds because redelivered heartbeat spans repeat identical `(trace_id, span_id, name)` tuples.
- Sample data ingestion path: regression-test that sample spans flow through the exact same consumer code as chat spans, tagged correctly via `llm.kind=sample` and `llm.sample_workspace_id` (HLD D5).

**Explicitly out of scope for this LLD (other workstreams):**
- `apps/api` Auto router, heartbeat scheduler, replay service, janitor, SSE fan-out subscriber, aggregates helper, clear-fence write path (backend-api LLD).
- `/console` UI, `/chat` provider selector, SSE client, replay diff UI (frontend-web LLD).
- `packages/contracts` schema updates for `llm.kind`, classifier/replay/sample attrs, `live-events` payload, SSE event shape (cross-cutting; gated below as a preflight). This LLD adds ONE contract test (snake_case naming) but does not own contract drafting.
- `packages/sdk` classifier adapter and pricing snapshot extensions (backend-api LLD).
- `messages.errorCode` semantics and `inferences.updatedAt` tick points from the API gateway (backend-api LLD; this LLD only declares the column and asserts no raw-SQL writers exist).

**Ownership boundary (load-bearing, preserved from Phase A):** the projection consumer remains a *reader and enricher*. It still never writes `messages.status`. New writes added in Phase B: (a) Phase B `inferences` columns (`kind`, `classifier_for_message_id`, `replay_of_inference_id`, `sample_workspace_id`) — set from span attributes during the existing enrichment write; (b) NEW: publish to `live-events` topic AFTER the existing DB transaction commits (never before, never on failure). The consumer does NOT write `sample_workspaces`, does NOT write `user_clear_fences`, does NOT write `sessions.current_sample_workspace_id` — those are owned by `apps/api`.

## Builder
**agent:** backend-infra-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** see `~/.claude/skills/oh/prompts/builder-addendum.md`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the actual tests via the wrapper

## File Structure (prose)

The workspace touched by this LLD is the same TypeScript monorepo Phase A established (pnpm 10.33.3 + Turborepo). New and edited paths fall into four buckets:

- **Prisma package (`packages/db/`):** edits `prisma/schema.prisma` to add the Phase B enum value list, two new models, three new FK relations on `Inference`, the `updatedAt` column on `Inference`, and one new pointer on `Session`; creates `prisma/migrations/0003_phase_b_kind_enum/migration.sql` (Prisma-generated then committed). The migration directory number is `0003` because Phase A landed `0001_init` and `0002_inference_trace_index`; this LLD assumes that state on `main` at build time and the builder verifies before generating. No changes to `src/index.ts` — existing PrismaClient export and re-exports cover the new types automatically. A new directory `packages/db/test/` carries the schema integration tests, with a db-local test harness (see Task 1a) since the Phase A test-helper lives under `apps/workers/test/helpers/integration-env.ts` and is not exported across package boundaries.
- **Workers app (`apps/workers/`):** edits `src/projection/span-mapper.ts` to read and propagate the four new attributes; edits `src/projection/projection.service.ts` to (a) insert the clear-fence check before any write, (b) include the new columns in update/create payloads, (c) publish to `live-events` after commit; creates `src/projection/clear-fence.ts` (pure lookup helper); creates `src/projection/live-events-publisher.ts` (kafkajs producer wrapper); edits `src/projection/projection.module.ts` to register the new publisher with lifecycle hooks; creates unit test files `test/span-mapper.phase-b.test.ts`, `test/clear-fence.test.ts`, `test/live-events-publisher.test.ts`; appends integration test cases to `test/projection.service.integration.test.ts`.
- **Contracts package (`packages/contracts/`):** ONE new test file `__tests__/sse.test.ts` asserting the `LiveEventsPayload` schema uses snake_case field names (the source-of-truth contract test). The contracts package itself is owned by a separate workstream that lands the schema before this LLD's Task 5; this test is the regression guard the workers depend on.
- **Infra (`infra/`):** edits `infra/redpanda/topics.sh` to also create the `live-events` topic idempotently. No edits to `infra/compose/docker-compose.yml` (no new services). No edits to `infra/otel/collector.yaml` (Phase A's existing collector config already satisfies the upstream-side ordering requirement; `live-events` is produced by `apps/workers` directly, not via the Collector).

Quality-gate commands (unchanged from Phase A, names confirmed against the worktree scaffold):
- typecheck: `pnpm -r typecheck`
- lint: `pnpm -r lint`
- test: `pnpm -r test`
- compose smoke: `docker compose -f infra/compose/docker-compose.yml up -d --wait`

## Open Questions

Logged but not blocking:

1. **`user_clear_fences` PK shape.** HLD D8 says "one row per user." *Default I will instruct:* `user_id` as the sole PK with `clear_after_ts` and `updated_at`; the consumer upsert path uses ON CONFLICT to overwrite (the api LLD owns the upsert; this LLD just declares the shape).
2. **`live-events` topic partitions.** HLD D3 does not pin a partition count; the api consumer is a single replica in Phase B. *Default I will instruct:* 3 partitions / 1 replica (same dev-cluster sizing as `traces`); README documents the per-user sticky-key path for multi-replica future scaling.
3. **`live-events` record key.** Per HLD D3 the payload is `{ user_id, kind, conversation_id }` and the api consumer fans out per-user. *Default I will instruct:* use `user_id` as the Kafka record key so per-user ordering is preserved across partitions (load-bearing for the SSE refetch contract).
4. **Default `kind` for Phase A rows.** Per HLD §Regression Risk + the `kind` enum lock, default is `chat`. *Default I will instruct:* `DEFAULT 'chat'` on the column at migration time; per the HLD `unknown` is reserved exclusively for "received via OTel but the producer's value was unrecognized" so Phase A backfill rows are honestly `chat`.
5. **`inferences.updated_at` existence.** Phase A schema does not declare an `updated_at` on `Inference` (it declares `@updatedAt` only on `Conversation` and `Message`). *Default I will instruct:* this LLD's schema task adds `updatedAt DateTime @updatedAt` to `Inference`. Per Prisma's contract, `@updatedAt` is CLIENT-managed (not a DB trigger): the column ticks only when writes go through PrismaClient. Hand-Off Risk §`@updatedAt` semantics (below) makes this discipline explicit.

## Hand-Off Risk Resolutions

These are decisions the LLD owns explicitly to remove ambiguity for the builder.

### Live-events publish ordering — load-bearing contract

The HLD D3 invariant "tick fires post-commit so client refetch is guaranteed to see the row" must be enforced in `projection.service.ts` as follows:

1. The existing trace_events insert + idempotency gate runs first (unchanged).
2. The existing inference write transaction runs second (unchanged, but now writes the new Phase B columns from span attributes).
3. AFTER the prisma transaction resolves successfully, AND only after, the service calls the publisher with the snake_case payload defined by the SSE contract.
4. If the publish throws, the service captures the error with Sentry `recoverable=yes` but does NOT roll back the DB write (the data is already persisted; a missed tick degrades to "user sees the row on their next manual refetch or the next tick from a subsequent turn").
5. If the DB transaction throws, no publish happens (the tick would be a lie).
6. Wording lock: the call IS awaited (so any synchronous publisher failure surfaces in the same batch), but the publisher catches its own kafkajs `send` errors internally — so the awaited promise resolves cleanly even when Kafka is unavailable. "Awaited with internal error swallowing" is the precise behavior; "fire-and-forget" was prior wording and is incorrect.
7. Double-publish guard: the publish only fires when the inference row was actually newly written or materially updated by this span — duplicate redeliveries that the trace_events idempotency gate filters out MUST NOT trigger a publish. Task 31 (RED) and Task 32 (GREEN) enforce this.

### `@updatedAt` semantics — Prisma client-managed only

Prisma's `@updatedAt` decorator ticks the column on writes that flow through PrismaClient. It is NOT a DB trigger; raw SQL `UPDATE inferences SET ...` will not tick the column. Therefore:

- Every code path that updates an `inferences` row MUST go through PrismaClient. The api LLD's stream-progress tick already does this (per Phase A's projection service patterns).
- Task 14a (non-TDD verification) greps `apps/api/src` and `apps/workers/src` for raw SQL `UPDATE inferences` and confirms none exist, or lists exceptions for review.
- The migration adds the column with `DEFAULT CURRENT_TIMESTAMP` for backfill on existing rows; subsequent updates rely on Prisma. No DB trigger is created.

### Clear-fence lookup performance

The fence check adds one `SELECT` per incoming span. The fence table is keyed on `user_id` (the PK), which the consumer already has from the user-id attribute on the span. The lookup is a single-row PK fetch — sub-millisecond. No batching or caching needed at Phase B volumes; README documents a per-batch fence cache as the next-scale optimization. The HLD's `WHERE user_id` index requirement is satisfied by the PK itself (no additional index needed since `user_id` IS the PK).

### Clear-fence ordering vs. trace-events audit

The clear-fence check fires BEFORE the trace_events insert. This means: a duplicate redelivery of an old span (before the fence) produces no trace_events audit row. This is intentional — the audit row is for ingestion forensics, and a span the user has explicitly cleared should not leave any record. The Task 24 RED test asserts this tradeoff explicitly (zero trace_events rows when the fence drops the span).

### Unknown-kind absorption — observable via Nest logger

Per HLD §Forward-Compat Locks the consumer maps any unrecognized `llm.kind` attribute value to `kind=unknown` on the row. The mapper does this with a discriminated check against the lock-listed enum values; on miss, it returns `kind=unknown` AND emits a structured warning via the existing NestJS `Logger` instance used by Phase A's span-mapper (NOT a separate OTel log pipeline — the LLD intentionally reuses Phase A's logger). The log line includes the unrecognized value verbatim. The downstream ops query is a per-user count grouped by `kind`, filtered to `kind=unknown`. Tasks 17-18 cover both the success-mapped values and the rejection-into-unknown branch and assert the warn line was emitted.

### Contracts dependency gate (every task depends on this)

`packages/contracts` must expose: (a) the four new OTel attribute symbols (`LLM_KIND`, `LLM_SAMPLE_WORKSPACE_ID`, `LLM_REPLAY_OF_INFERENCE_ID`, `LLM_CLASSIFIER_FOR_MESSAGE_ID`); (b) the `LiveEventsPayload` zod schema with snake_case fields `user_id`, `kind`, `conversation_id`; (c) an `InferenceKind` string-union type matching the schema enum values. Task 0 is the explicit preflight gate that blocks the rest of the plan if these are not present. EVERY later task in this LLD depends on Task 0 passing — not only the ones that import contracts directly. If contracts are missing or contradictory, the builder stops the entire plan.

### Heartbeat ingestion idempotency — regression risk acknowledgement

Heartbeat spans arrive at high frequency (per HLD D6 the api emits at a fixed cadence; LLD-time the api owns the actual interval). The `UNIQUE(trace_id, span_id, name)` index on `trace_events` (widened in migration `0003` per Tasks 5a/5b) continues to be the idempotency primitive. The wider key still dedupes redeliveries — a redelivered span repeats the same `(trace_id, span_id, name)` tuples, so its first event hits P2002 and the consumer short-circuits — while correctly allowing multiple distinct named events per span on first delivery. Tasks 31/32 below are a regression pair that fires a burst of heartbeat spans with duplicate redeliveries and asserts the row counts match the unique-span count, AND that exactly that many `live-events` messages were published (not one per redelivery). No change to the consumer's idempotency code path — the tests exist specifically to prove the regression risk does not materialize.

### Sample ingestion path — no parallel write code

HLD D5 requires sample spans flow through the same code path as chat. The consumer's only differentiator is the `llm.kind` attribute and the `llm.sample_workspace_id` attribute — there is NO branch in `projection.service.ts` on `kind=sample`. Task 35 is a regression test that asserts a sample span and a chat span produce the same persistence side-effects (same shape of `(inferences, trace_events)` rows, differing only in the populated columns). Per the Codex review, the test verifies observable persistence behavior only (no invasive same-code-path instrumentation).

### Snake_case payload — source of truth

The HLD locked the `live-events` payload as `{ user_id, kind, conversation_id }` (snake_case). This matches the existing OTel attribute naming convention. The contract test (Task 4) asserts this shape against the `LiveEventsPayload` schema. Workers code (Task 28) constructs and publishes with snake_case field names. Any future drift between contracts and consumers is caught by Task 4 at CI time.

## Tasks

Task numbering convention: RED tasks pair with the immediately following GREEN task. Schema, infra, and module-wiring tasks are labelled `[non-TDD — <reason>]`. Regression tests verifying a prior GREEN are labelled `[regression — verifies preceding GREEN]`.

**Pre-existing baseline (read before building):** 3 integration tests in `apps/workers/test/projection.service.integration.test.ts` (enriches-placeholder, idempotent-under-duplicate, redelivery-short-circuits) fail at baseline because the current `(trace_id, span_id)` constraint blocks multi-event spans (the span-mapper writes one `trace_events` row per span event, so the 2nd event of every span violates the old 2-column unique). The constraint-widening GREEN task (Task 5b below) turns them green. The builder should run that suite after the `0003` migration lands and confirm all three pass — they are NOT new-work failures.

---

### Task 0: [non-TDD — preflight dependency gate] Verify contracts package exposes Phase B types

**Files:** read-only check against `packages/contracts/src/index.ts` and the source files it re-exports
**What to do:** Confirm the contracts package's public surface (its top-level `index.ts` exports) includes the four new OTel attribute key symbols, the `LiveEventsPayload` zod schema, and the `InferenceKind` string-union type. If any is absent, stop and surface a blocking signal to the orchestrator — do not invent the shapes here. EVERY subsequent task depends on this gate.
**Acceptance:** Static import resolution from a throwaway TypeScript file in the workers app can `import { LLM_KIND, LLM_SAMPLE_WORKSPACE_ID, LLM_REPLAY_OF_INFERENCE_ID, LLM_CLASSIFIER_FOR_MESSAGE_ID, LiveEventsPayload, InferenceKind } from '@argus/contracts'` without TS errors. (Stronger than grep — proves exports are public, not just declared in comments or non-exported imports.)
**Verify:** `pnpm --filter @argus/workers exec tsc --noEmit -p tsconfig.json` after adding a one-line `import { ... }` smoke into a sandbox `.ts` file under `apps/workers/scratch/contracts-check.ts`; remove the scratch file after success.

---

### Task 1a: [non-TDD — test harness setup] Create db-package integration test harness

**Files:** `packages/db/test/helpers/prisma-testcontainer.ts` (new file), `packages/db/package.json` (add `testcontainers` devDep + jest config), `packages/db/jest.config.ts` (new file)
**What to do:** Create a db-local Postgres testcontainer helper modeled on `apps/workers/test/helpers/integration-env.ts` but contained within the db package (no cross-package import). The helper exposes a `withTestPrisma` async wrapper that boots a fresh Postgres container, runs `prisma migrate deploy`, and returns a PrismaClient pointed at the temporary database. Configure jest to run `*.test.ts` files under `packages/db/test/`. Add `testcontainers` (matching workers' pinned version) to devDependencies.
**Acceptance:** `pnpm --filter @argus/db test --passWithNoTests` exits 0 with jest reporting "No tests found" (harness wires up but no tests yet); `pnpm --filter @argus/db typecheck` exits 0.
**Verify:** `pnpm --filter @argus/db test --passWithNoTests && pnpm --filter @argus/db typecheck`.

---

### Task 1b: [non-TDD — migration numbering check] Confirm next migration prefix

**Files:** read-only against `packages/db/prisma/migrations/`
**What to do:** Inspect the existing migrations directory. Phase A is expected to be on `0001_init` and `0002_inference_trace_index`. Confirm the next available numeric prefix is `0003`. If a different number is needed (e.g. main has advanced), document the actual next number and use it for every subsequent task that references the migration name.
**Acceptance:** Builder confirms in the task log that the migration directory used for Tasks 5/7/9/11/13/15/17/19 is `0003_phase_b_kind_enum` (or the bumped number if drift occurred).
**Verify:** `ls packages/db/prisma/migrations/` shows existing prefixes; chosen prefix is greater than the highest existing.

---

### Task 2 (RED): Failing contract test — `LiveEventsPayload` schema uses snake_case

**Files:** `packages/contracts/__tests__/sse.test.ts` (new file)
**What to do:** Write a failing test that imports `LiveEventsPayload` from the contracts package and asserts the schema's parsed shape carries snake_case field names (`user_id`, `kind`, `conversation_id`). The test fails today because either (a) the contracts package has not landed this schema (Task 0 caught that), or (b) the schema landed with camelCase and the contract drift must be fixed in the contracts workstream before this LLD proceeds. Name the behavior ("LiveEventsPayload schema exposes snake_case field names per the HLD lock").
**Acceptance:** Test exists, runs under `pnpm --filter @argus/contracts test`, and fails for the expected reason (schema missing or wrong casing). If Task 0 already confirmed snake_case is in place, the test passes immediately and the builder logs that as a regression guard rather than a RED.
**Verify:** `pnpm --filter @argus/contracts test __tests__/sse.test.ts` reports the expected failure or passes as a regression guard.

---

### Task 3 (GREEN): No-code task — confirm contracts already satisfy snake_case OR escalate

**Files:** none (or escalation note to the contracts workstream)
**What to do:** If Task 2 failed, the contracts package must be fixed in its own workstream before this LLD can proceed. Stop the plan and surface to the orchestrator. If Task 2 passed, mark this task complete with no code change — the contract is correct.
**Acceptance:** Task 2 passes.
**Verify:** `pnpm --filter @argus/contracts test`.

---

### Task 4 (RED): Failing schema test — `kind` enum type exists on inferences

**Files:** `packages/db/test/schema-phase-b.test.ts` (new file)
**What to do:** Write a failing integration-style schema test using the Task 1a harness. The test boots a Postgres testcontainer, runs `prisma migrate deploy`, then queries `information_schema.columns` for the `inferences.kind` column. Asserts the column exists, has the Postgres enum type `inference_kind` in `udt_name`, is NOT NULL, and defaults to `chat`. Name the behavior ("inferences table carries the kind enum column with default chat, backed by a Postgres enum type named inference_kind").
**Acceptance:** Test exists, runs, fails because the column has not been added to the schema yet.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails with the expected reason.

---

### Task 5 (GREEN): Add `kind` enum + column to Prisma schema and generate migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add a new Prisma enum model named `InferenceKind` with six values (chat | classifier | replay | sample | heartbeat | unknown) and `@@map("inference_kind")` so the underlying Postgres type is `inference_kind`. Add a `kind` field of type `InferenceKind` with default `chat` to the `Inference` model with `@map("kind")`. Generate the migration via `prisma migrate dev --name phase_b_kind_enum --create-only` against a throwaway local Postgres; commit `migration.sql`. The migration must declare a CREATE TYPE for the Postgres enum named `inference_kind`, and ALTER the `inferences` table to add a NOT NULL `kind` column of that enum type with default `'chat'`.
**Acceptance:** Task 4 test passes with both assertions holding simultaneously — the Postgres catalog type name is `inference_kind` AND the Prisma model name (visible in the generated client types) is `InferenceKind`. Both must be true, NOT either-or. `prisma format` rewrites with no diff; `prisma validate` exits 0.
**Verify:** `pnpm --filter @argus/db exec prisma format && pnpm --filter @argus/db exec prisma validate && pnpm --filter @argus/db test test/schema-phase-b.test.ts`.

---

### Task 5a (RED): Failing integration test — a single span persists BOTH of its named events

**Files:** `packages/db/test/trace-events-multi-event.test.ts` (new file)
**What to do:** Using the Task 1a harness, write a failing integration test that inserts two `trace_events` rows for ONE span — same `trace_id` and `span_id`, different `name` (`llm.input` and `llm.output`) — and asserts both rows persist. With the Phase A `(trace_id, span_id)` unique constraint the second insert is rejected and only one row survives, so the test fails at baseline. (This is the same behavior the three `apps/workers` integration tests in the Pre-existing baseline note exercise; this db-package test is the local guard for the constraint shape.) Name the behavior ("a single span with two distinct event names persists both trace_events rows").
**Acceptance:** Test exists, runs, and fails because the old 2-column unique blocks the second event row (only one row found instead of two).
**Verify:** `pnpm --filter @argus/db test test/trace-events-multi-event.test.ts` fails with the expected reason.

---

### Task 5b (GREEN): Widen the `trace_events` unique to `(trace_id, span_id, name)` and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Change the `TraceEvent` model's `@@unique([traceId, spanId])` to `@@unique([traceId, spanId, name])`. Regenerate the migration so it DROPs the existing `trace_events_trace_id_span_id_key` constraint and ADDs the 3-column unique on `(trace_id, span_id, name)`. Apply via `prisma migrate dev`. The widening allows the legitimate multi-event-per-span case on first delivery while a redelivered span (repeating identical tuples) still collides on its first event, preserving the idempotency gate.
**Acceptance:** Task 5a passes (both event rows persist); the three `apps/workers` baseline integration tests now pass; Tasks 4/5 still pass; `prisma validate` exits 0.
**Verify:** `pnpm --filter @argus/db test test/trace-events-multi-event.test.ts && pnpm --filter @argus/workers test test/projection.service.integration.test.ts`.

---

### Task 6 (RED): Failing schema test — index on `inferences(kind)` exists

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that queries `pg_indexes` for an index on `inferences.kind` (the default-equality-predicate index aggregates rely on per HLD §Regression Risk). Name the behavior ("inferences carries a btree index on the kind column").
**Acceptance:** New case fails because Task 5's migration did not add this index.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 7 (GREEN): Add `@@index([kind])` and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add `@@index([kind])` to the `Inference` model; regenerate the migration so it includes the CREATE INDEX statement. Apply via `prisma migrate dev`.
**Acceptance:** Task 6 case passes; Tasks 4 and 5 still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 8 (RED): Failing schema test — `sample_workspaces` table exists

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that queries `information_schema.tables` for `sample_workspaces` and `information_schema.columns` for its three columns: id (UUID PK), user_id (UUID, FK to users), created_at (timestamp, default now). Name the behavior ("sample_workspaces table exists with id, user_id, created_at").
**Acceptance:** Test case fails because the table does not exist.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 9 (GREEN): Add `SampleWorkspace` model and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add a `SampleWorkspace` Prisma model with `id` (uuid PK), `userId` FK to `User`, `createdAt`, `@@map("sample_workspaces")` plus `@@index([userId])`. FK delete semantics are owned by Tasks 11/12 (the dedicated RED/GREEN pair). Regenerate the migration so it includes the CREATE TABLE + FK + index. Apply via `prisma migrate dev`.
**Acceptance:** Task 8 case passes; all prior schema tests still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 10 (RED): Failing schema test — `user_clear_fences` table exists

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that queries the catalog for `user_clear_fences` and asserts its three columns: user_id (UUID PK, FK to users), clear_after_ts (timestamp, NOT NULL), updated_at (timestamp, default now). Name the behavior ("user_clear_fences table exists keyed on user_id").
**Acceptance:** Test case fails because the table does not exist.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 11 (GREEN): Add `UserClearFence` model and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add a `UserClearFence` Prisma model with `userId` as the sole `@id` (uuid FK to `User`), `clearAfterTs DateTime @map("clear_after_ts")`, `updatedAt DateTime @updatedAt @map("updated_at")`, and `@@map("user_clear_fences")`. Per Hand-Off Risk §Clear-fence lookup performance, no additional index is needed (PK covers the lookup). FK delete semantics are owned by Tasks 12/13. Regenerate the migration so it includes the CREATE TABLE + FK. Apply via `prisma migrate dev`.
**Acceptance:** Task 10 case passes; all prior schema tests still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 12 (RED): Failing schema test — FK delete semantics for sample_workspaces and sessions pointer

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case with two assertions: (a) deleting a user row cascades to remove that user's `sample_workspaces` rows (verifies `ON DELETE CASCADE` on `sample_workspaces.user_id`); (b) deleting a `sample_workspaces` row that is referenced by `sessions.current_sample_workspace_id` results in the session's pointer being set to NULL, not the session being deleted (verifies `ON DELETE SET NULL` on the sessions pointer). The test seeds a user, a sample workspace, and a session pointing at that workspace, then exercises both deletions. Name the behavior ("FK delete semantics: user→sample_workspaces cascade, sample_workspace→session.pointer SET NULL").
**Acceptance:** Test case fails because the delete semantics are not yet declared (Tasks 9 and 11 left the defaults).
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 13 (GREEN): Declare ON DELETE CASCADE on sample_workspaces.user_id and ON DELETE SET NULL on sessions.current_sample_workspace_id

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add `onDelete: Cascade` to the `SampleWorkspace.user` relation. Defer the sessions pointer's `onDelete: SetNull` declaration to Task 16 since the column is added there — but the test from Task 12 only asserts cascade for now (the SET NULL half of the assertion comes online once Task 16 lands; split if needed at builder discretion to keep this task small). Regenerate the migration so the FK constraints include the new delete actions. Apply.
**Acceptance:** The cascade half of Task 12 passes; the SET NULL half remains failing until Task 16 lands and is acceptable in the interim.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` shows the cascade assertion passing.

---

### Task 14 (RED): Failing schema test — three new FK columns on `inferences`

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that asserts three nullable columns exist on `inferences`: classifier_for_message_id (UUID, FK to `messages.id`), replay_of_inference_id (UUID, self-FK to `inferences.id`), sample_workspace_id (UUID, FK to `sample_workspaces.id`). Each FK is nullable and visible in `information_schema.referential_constraints`. Name the behavior ("inferences carries classifier/replay/sample-workspace FKs all nullable").
**Acceptance:** Test case fails because the columns do not exist.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 15 (GREEN): Add three nullable FKs to `Inference` model and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add three nullable relations to `Inference`: a classifier-for-message relation to `Message`, a self-relation for replay-of-inference, and a sample-workspace relation to `SampleWorkspace`. Each is mapped to its snake_case column. Add the back-relations on the parent models with matching relation names. Add three indexes on the three new columns since they are Phase B query filter columns. Regenerate the migration; apply.
**Acceptance:** Task 14 case passes; all prior schema tests still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 16 (RED): Failing schema test — `sessions.current_sample_workspace_id` pointer exists with SET NULL semantics

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that asserts `sessions.current_sample_workspace_id` exists as a nullable UUID FK to `sample_workspaces.id` AND has `ON DELETE SET NULL`. This is the second half of Task 12's FK-semantics assertion that was deferred. Name the behavior ("sessions carries a nullable current sample workspace pointer with SET NULL on delete").
**Acceptance:** Test case fails because the column does not exist.
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 17 (GREEN): Add `currentSampleWorkspaceId` to `Session` model with SET NULL delete and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add the `currentSampleWorkspaceId` field to `Session` with relation to `SampleWorkspace`, declaring `onDelete: SetNull` so losing the workspace does not delete the session. Add the back-relation on `SampleWorkspace`. Regenerate the migration; apply.
**Acceptance:** Task 16 case passes; Task 12's deferred SET NULL half now passes; all prior schema tests still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 18 (RED): Failing schema test — `inferences.updated_at` column exists and ticks via Prisma writes

**Files:** Append a case to `packages/db/test/schema-phase-b.test.ts`
**What to do:** Add a failing test case that asserts `inferences.updated_at` exists (HLD D9 janitor predicate). The test inserts an inferences row via PrismaClient, reads `updated_at`, sleeps a small interval, updates a different column via PrismaClient, re-reads, and asserts the new `updated_at` is strictly greater. Name the behavior ("inferences.updated_at exists and ticks on Prisma-mediated update").
**Acceptance:** Test case fails because the column does not exist (Phase A schema declared `@updatedAt` only on Conversation and Message — see Open Question §5).
**Verify:** `pnpm --filter @argus/db test test/schema-phase-b.test.ts` fails on the new case.

---

### Task 19 (GREEN): Add `updatedAt` to `Inference` model and amend the Phase B migration

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_phase_b_kind_enum/migration.sql`
**What to do:** Add `updatedAt DateTime @updatedAt @map("updated_at")` to `Inference`. Regenerate the migration so it includes the ADD COLUMN with `DEFAULT CURRENT_TIMESTAMP` to backfill existing rows. Per Hand-Off Risk §`@updatedAt` semantics, this is Prisma-client-managed only; no DB trigger is created.
**Acceptance:** Task 18 case passes; all prior schema tests still pass.
**Verify:** `pnpm --filter @argus/db test`.

---

### Task 20: [non-TDD — raw-SQL audit] Confirm no raw `UPDATE inferences` statements exist

**Files:** read-only grep across `apps/api/src` and `apps/workers/src`
**What to do:** Per Hand-Off Risk §`@updatedAt` semantics, Prisma `@updatedAt` only ticks on writes through PrismaClient. Grep both source trees for any raw SQL `UPDATE inferences` statement (whether in `$executeRaw`, `$queryRaw`, or string concatenated SQL). Confirm zero matches; if any exist, document each as an exception and route to the api LLD owner for resolution.
**Acceptance:** Grep returns zero matches across both source trees, OR each match is listed in the builder log with the file path, line number, and a justification.
**Verify:** `grep -RIn -E "UPDATE\s+inferences" apps/api/src apps/workers/src || echo OK_NO_RAW_UPDATES`.

---

### Task 21 (RED): Failing unit test — span-mapper reads `llm.kind` and propagates it

**Files:** `apps/workers/test/span-mapper.phase-b.test.ts` (new file; do NOT pollute Phase A's `span-mapper.test.ts`)
**What to do:** Write a failing test that imports the span-mapper and verifies, for an OTLP span carrying `llm.kind=classifier`, that the returned inference verdict carries kind classifier. Add two more cases for `llm.kind=replay` and `llm.kind=sample` propagating to the matching verdict kind. Name the behavior ("span-mapper propagates llm.kind onto the inference verdict for known values").
**Acceptance:** Test fails because the Phase A mapper does not read `llm.kind`.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.phase-b.test.ts` fails with the expected reason.

---

### Task 22 (GREEN): Extend span-mapper to read `llm.kind` for known values

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Read the `LLM_KIND` attribute from the span attributes; map the value against the locked enum list (chat | classifier | replay | sample | heartbeat); set the corresponding `kind` field on the inference verdict. Do NOT yet handle the unknown-value branch — that comes in Tasks 23-24.
**Acceptance:** Task 21 cases pass; Phase A `span-mapper.test.ts` still passes.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 23 (RED): Failing unit test — span-mapper maps unrecognized `llm.kind` to `unknown` AND logs

**Files:** Append a case to `apps/workers/test/span-mapper.phase-b.test.ts`
**What to do:** Add a failing test case asserting: (a) when `llm.kind` is missing from span attributes, the verdict carries kind chat (the default for legacy/Phase-A producers); (b) when `llm.kind` carries an unrecognized value (e.g. a future-kind-xyz string), the verdict carries kind unknown (NOT chat, per HLD §Forward-Compat Locks) AND a NestJS Logger warn-level call was made carrying the unrecognized value. Name the behavior ("span-mapper defaults missing kind to chat and routes unrecognized values to unknown with a logger.warn carrying the value").
**Acceptance:** New cases fail because Task 22's mapper does not have these branches.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.phase-b.test.ts` fails on the new cases.

---

### Task 24 (GREEN): Add default-chat + unknown-bucket + warn-log branches to span-mapper

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Add the two branches: missing `llm.kind` → kind chat; unrecognized value → kind unknown AND a logger.warn call that includes the unrecognized value and a phase tag matching Hand-Off Risk §Unknown-kind absorption.
**Acceptance:** Tasks 21 and 23 cases all pass (including the warn-log assertion); Phase A `span-mapper.test.ts` still passes.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 25 (RED): Failing unit test — span-mapper propagates classifier/replay/sample-workspace FKs

**Files:** Append a case to `apps/workers/test/span-mapper.phase-b.test.ts`
**What to do:** Add a failing test case for three branches: (a) span with kind classifier and the classifier-for-message-id attribute produces a verdict carrying that uuid; (b) span with kind replay and the replay-of-inference-id attribute produces a verdict carrying that uuid; (c) span with kind sample and the sample-workspace-id attribute produces a verdict carrying that uuid. Name the behavior ("span-mapper propagates the three Phase B FK attributes onto the inference verdict").
**Acceptance:** New cases fail because Task 24's mapper does not read these attributes.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.phase-b.test.ts` fails on the new cases.

---

### Task 26 (GREEN): Extend span-mapper to propagate the three Phase B FK attributes

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Read the three new attribute symbols from span attributes and write them to the corresponding fields on the inference verdict. Each is independent and nullable — a span without any of them produces null FK fields. No validation of UUID shape here; the DB FK constraint catches malformed values at write time (and the resulting error path is owned by the existing projection error capture).
**Acceptance:** Task 25 cases pass; all prior tests still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 27 (RED): Failing unit test — clear-fence helper returns the correct verdict

**Files:** `apps/workers/test/clear-fence.test.ts` (new file)
**What to do:** Write a failing test for the clear-fence helper covering three cases: (a) no fence row exists for the user → verdict "no-fence" (proceed); (b) fence exists with `clearAfterTs > spanStartedAt` → verdict "drop" (span is before the fence); (c) fence exists with `clearAfterTs <= spanStartedAt` → verdict "proceed" (span is at or after the fence). Use the existing Phase A testcontainer helper from `apps/workers/test/helpers/integration-env.ts`. Name the behavior ("clear-fence helper drops spans older than the user fence, proceeds otherwise").
**Acceptance:** Test fails because the helper module does not yet exist.
**Verify:** `pnpm --filter @argus/workers test test/clear-fence.test.ts` fails with the expected reason.

---

### Task 28 (GREEN): Implement clear-fence helper

**Files:** `apps/workers/src/projection/clear-fence.ts`
**What to do:** Implement a pure async helper. The helper accepts a Prisma client, the user id, and the span's startedAt timestamp; returns a discriminated verdict per the three cases in Task 27. Uses one Prisma `findUnique` on the user-clear-fence model keyed by user id. No internal caching in Phase B (see Hand-Off Risk §Clear-fence lookup performance).
**Acceptance:** Task 27 cases pass; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 29 (RED): Failing integration test — projection drops a span when the fence is ahead of `startedAt`

**Files:** Append a case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a failing integration test case that: (a) seeds a `user_clear_fences` row for a known user with `clear_after_ts = now + 1h`; (b) invokes the projection service's handle method with a fabricated span carrying that user's id and a startedAt time well before the fence. Acceptance: the test fails because the projection does not yet enforce the fence — observable as the test asserting zero post-fence rows / drop log line and failing on either assertion.
**Acceptance:** Case fails because `projection.service.ts` does not yet call the clear-fence helper.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new case.

---

### Task 30 (GREEN): Wire clear-fence enforcement into ProjectionService

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** At the start of the handle method, after the zod parse but before the trace_events idempotency gate, call the clear-fence helper with the Prisma client, the span's user id, and the span's startedAt timestamp. If the verdict is "drop", emit a structured NestJS Logger warn call tagged for clear-fence drops with the user/trace/span/startedAt/fenceTs context, and return early — no trace_events insert, no inference write, no live-events publish. If the verdict is "no-fence" or "proceed", continue with the existing flow.
**Acceptance:** Task 29 case passes; Phase A integration cases still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 31 (RED): Failing integration test — live-events publish AFTER commit, NOT before, NOT on failure, NOT on duplicate redelivery

**Files:** Append a case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a failing integration test with three observable assertions:
- (a) Order: invoke handle on a fresh span; assert via call-order spy that the publish call happens AFTER the prisma transaction callback resolves.
- (b) DB failure: configure prisma to throw inside the transaction; assert publish is NEVER called.
- (c) Duplicate redelivery: invoke handle twice on the same span (the redelivery repeats identical `(trace_id, span_id, name)` tuples, so it still collides under the widened unique). Assert exactly ONE inference row exists (idempotency holds) AND exactly ONE publish call was made (NOT two — the publisher must not fire on the redelivery that was filtered by the trace_events unique index).
Name the behaviors ("publish happens after commit", "no publish on DB failure", "no publish on duplicate redelivery").
**Acceptance:** Case fails because `projection.service.ts` does not yet integrate the publisher with these guards.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new cases.

---

### Task 32 (RED→GREEN): Failing unit test for LiveEventsPublisher + implement it

**Files:** `apps/workers/test/live-events-publisher.test.ts` (new file), `apps/workers/src/projection/live-events-publisher.ts` (new file)
**What to do:**
- RED half — write a failing unit test for the publisher using a mocked kafkajs producer. The publisher accepts the snake_case payload defined by the SSE contract (`user_id`, `kind`, `conversation_id`). The test covers: (i) calling publish invokes the producer's send with topic `live-events`, record key equals `user_id`, and record value parses against `LiveEventsPayload` (snake_case fields hold); (ii) on send rejection, the publisher captures via Sentry with `recoverable=yes` but does not re-throw (per Hand-Off Risk §Live-events publish ordering); (iii) lifecycle: a fresh module instantiation calls producer.connect on `onModuleInit` and producer.disconnect on `onModuleDestroy`.
- GREEN half — implement the publisher as a Nest `@Injectable` with `OnModuleInit`/`OnModuleDestroy`. Constructor takes a kafkajs `Kafka` client created from env-driven `REDPANDA_BROKERS`. `onModuleInit` connects the producer; `onModuleDestroy` disconnects. Publish builds the snake_case payload, sends to topic from env `REDPANDA_LIVE_EVENTS_TOPIC` (default `live-events`), keyed by `user_id`. Errors funnel through the existing projection error capture with `recoverable=yes`; do not re-throw.
**Acceptance:** Test file's RED cases initially fail for missing module; after the GREEN implementation lands in the same task, all three test groups (publish, error swallowing, lifecycle) pass.
**Verify:** `pnpm --filter @argus/workers test test/live-events-publisher.test.ts`.

---

### Task 33 (GREEN): Wire LiveEventsPublisher into ProjectionService post-commit with idempotency guard

**Files:** `apps/workers/src/projection/projection.service.ts`, `apps/workers/src/projection/projection.module.ts`
**What to do:** Inject the publisher into ProjectionService. Register it as a provider in ProjectionModule (single place — this is the only module-wiring task; no separate registration task elsewhere). After the existing prisma transaction resolves successfully (and after the existing trace_events inserts), evaluate whether the trace_events insert was a real insert (new row) versus a no-op caused by the unique-index conflict (duplicate redelivery). Only publish on real inserts. The publisher payload is the snake_case `{ user_id, kind, conversation_id }` sourced from the projected verdict. The call is awaited so synchronous publisher failures surface in-batch; the publisher's internal catch ensures the await still resolves on Kafka errors.
**Acceptance:** Task 31's three assertions all pass; all prior tests still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 34 (RED): Failing integration test — proceed branch persists the span and publishes

**Files:** Append a case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a failing test case that pre-conditions on Task 33's wiring being incomplete: seed a `user_clear_fences` row with `clear_after_ts = now - 1h` for one user and no fence row for another user. For each user, invoke handle with a span at startedAt = now. Assert that BOTH users' spans result in: one `inferences` row, one `trace_events` row, AND one publish call. The test fails today because Task 33's publish wiring may not yet route both code paths correctly; verifies the proceed branch and the no-fence branch end-to-end. Name the behavior ("clear-fence proceed and no-fence branches both persist and publish exactly once").
**Acceptance:** Case fails until Task 33's wiring lands, OR — if Task 33 already passes this assertion — the task is reclassified inline as `[regression — verifies preceding GREEN]` for Task 33 and the builder logs that classification.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts`.

---

### Task 35 (RED): Failing integration test — Phase B write payload includes the four new columns

**Files:** Append a case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a failing test case that seeds a `sample_workspaces` row for a known user, then injects one OTLP span carrying `llm.kind=sample` and the sample-workspace-id attribute for that user. Invoke handle. Assert that the resulting `inferences` row has kind sample and the sample_workspace_id column equal to the seeded workspace id. Add a sibling assertion: a `kind=chat` span on the same user produces an inferences row with kind chat and sample_workspace_id NULL — same code path, different payload (the HLD D5 "no parallel write code" invariant). Acceptance: the test asserts the inferences row's kind/FK columns match the seeded values for both cases.
**Acceptance:** Case fails because Task 36 has not yet extended the write payload to include the four Phase B columns.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new case.

---

### Task 36 (GREEN): Wire the new Phase B columns through ProjectionService write payload

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** Extend both the update and create payloads inside the existing prisma transaction block to include the four new fields from the mapper verdict: kind, classifier_for_message_id, replay_of_inference_id, sample_workspace_id. No new branches — the columns are written unconditionally from whatever the mapper produced. When the mapper omits or defaults `kind`, the DB default `chat` applies; the integration test in Task 35 already covers the default-chat path.
**Acceptance:** Task 35 cases pass; all prior tests still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 37 [regression — verifies preceding GREEN]: Heartbeat idempotency burst

**Files:** Append a case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a regression test that fabricates a burst of OTLP spans with `llm.kind=heartbeat`, each with a distinct `(trace_id, span_id)`, all for one user. Invoke handle on each. Then invoke handle a second time on half of them (duplicate redelivery). Acceptance: the test asserts the expected row count matches the unique-span burst size for both `trace_events` and `inferences` (kind=heartbeat), AND the number of recorded publish calls also matches the unique-span count (NOT the total invocation count). This is the explicit regression guard for Tasks 22/24/30/33 not breaking the idempotency path or double-publishing.
**Acceptance:** Test passes against the current code (no regression). If it fails, the responsible Phase B task is the diagnosed cause.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts`.

---

### Task 38: [non-TDD — Redpanda bootstrap] Add `live-events` topic to topics.sh

**Files:** `infra/redpanda/topics.sh`
**What to do:** Extend the bootstrap script to also create the `live-events` topic idempotently, mirroring the structure used for `traces` (loop or duplicated block per existing style — builder inspects current file and follows the existing convention). Per Open Question §2: 3 partitions / 1 replica. Add env overrides `REDPANDA_LIVE_EVENTS_TOPIC`, `REDPANDA_LIVE_EVENTS_PARTITIONS`, `REDPANDA_LIVE_EVENTS_REPLICAS` modeled on the existing `REDPANDA_TRACES_TOPIC` / `REDPANDA_TRACES_PARTITIONS` / `REDPANDA_TRACES_REPLICAS` names already present in the script. The record key (set by the publisher in Task 32) is `user_id` — the bootstrap script does NOT set partition keys, only topic shape.
**Acceptance:** Script declares creation of both `traces` and `live-events`; running against a fresh Redpanda creates both topics; re-running does not error; setting `REDPANDA_LIVE_EVENTS_TOPIC=foo` causes the bootstrap to create topic `foo` instead of `live-events`; `bash -n infra/redpanda/topics.sh` passes shellcheck-clean.
**Verify:** `bash -n infra/redpanda/topics.sh && grep -E "REDPANDA_LIVE_EVENTS_TOPIC|REDPANDA_LIVE_EVENTS_PARTITIONS|REDPANDA_LIVE_EVENTS_REPLICAS" infra/redpanda/topics.sh | wc -l` returns at least 3.

---

### Task 39a: [non-TDD — compose-up smoke] Verify `live-events` topic exists post-compose-up

**Files:** No new files
**What to do:** Bring compose up and confirm the bootstrap script created the `live-events` topic alongside `traces`. Confirm the partition count is 3.
**Acceptance:** Both topics appear in `rpk topic list`; describe shows 3 partitions for `live-events`.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait && docker compose -f infra/compose/docker-compose.yml exec redpanda rpk topic describe live-events | grep -i "partitions" | head -1`.

---

### Task 39b: [non-TDD — worker startup smoke] Verify workers log "live-events publisher ready"

**Files:** No new files (asserts behavior of Tasks 32/33)
**What to do:** With compose up, observe workers container logs within 5 seconds of boot. Confirm a log line indicating the live-events publisher connected successfully (mirroring the wording Phase A's projection consumer uses for its own readiness log).
**Acceptance:** A "live-events publisher ready" (or equivalent connected-state) line appears in `docker compose logs workers` within 5 seconds of container ready.
**Verify:** `docker compose -f infra/compose/docker-compose.yml logs workers --tail 200 | grep -i "live-events"`.

---

### Task 39c: [non-TDD — end-to-end ordering smoke] Publish appears AFTER row commit

**Files:** No new files
**What to do:** With compose up, POST one synthetic OTLP span carrying `llm.kind=chat` to the OTel Collector OTLP endpoint. Then: query Postgres for the inference row and confirm it exists. Then: read one message from the `live-events` topic (using `rpk topic consume`). Assert the Kafka message is observed AFTER the DB row is observed (ordering proof) and that the record key matches the span's user_id attribute and the record value parses as `LiveEventsPayload`.
**Acceptance:** The Postgres query returns the inference row first; the Kafka consume command then succeeds within 5 seconds; the record's key equals the span's user_id and its value parses against the contract schema.
**Verify:** Three-step shell sequence (curl POST, psql SELECT, rpk topic consume) documented; captured output attached to the PR description.

---

### Task 40: [non-TDD — README documentation] Document Phase B backend-infra smoke procedure

**Files:** `apps/workers/README.md`
**What to do:** Append a section documenting the exact shell sequence from Tasks 39a/39b/39c, plus the schema-migration smoke (prisma migrate deploy against a fresh testcontainer asserts all eight Phase B columns / two new tables exist). Reference Phase A's existing smoke as the starting point. Document the expected end-to-end timing budget from POST to live-events appearance (under 2s typical, under 5s as the PRD's 5-second live-bar quality bar).
**Acceptance:** README section exists at a predictable header.
**Verify:** `grep -q "Phase B backend-infra smoke" apps/workers/README.md`.

---

## Quality Gates

- typecheck: `pnpm -r typecheck`
- lint: `pnpm -r lint`
- test: `pnpm --filter @argus/contracts test && pnpm --filter @argus/workers test && pnpm --filter @argus/db test`
- compose smoke: `docker compose -f infra/compose/docker-compose.yml up -d --wait && docker compose -f infra/compose/docker-compose.yml exec redpanda rpk topic list`

## Dependencies

- **`packages/contracts`** (cross-cutting; HLD §Component Map says "extends OTel attrs and adds the SSE event + console row shapes + `live-events` payload shape"): all four new OTel attribute key symbols, the `LiveEventsPayload` zod schema (snake_case fields), and the `InferenceKind` string-union type must exist before Task 4 — Task 0 is the explicit preflight gate. EVERY task in this LLD depends on Task 0 passing.
- **`apps/api`** (backend-api LLD): owns the placeholder-row insert (unchanged from Phase A), owns the writes to `user_clear_fences` (the api Clear flow writes/updates rows there; this LLD only reads them), owns the writes to `sample_workspaces` and `sessions.current_sample_workspace_id` (the api Generate-Samples flow), owns the heartbeat span emit (this LLD only ingests them), owns the `inferences.updatedAt` tick on stream progress through PrismaClient (this LLD only declares the column and verifies no raw-SQL writers exist).
- **`apps/web`** (frontend-web LLD): consumes the live-events tick indirectly via SSE — no direct contract with this LLD.

## Reviewer Concerns To Watch (preemptive)

- **`kind` enum coverage in default reads.** This LLD does NOT modify any read paths — that's the api LLD's job. The risk per HLD §Regression Risk is "every default read filters on kind — missing the filter in one place is the most likely regression vector." This LLD's contribution to that risk is bounded: it provides the column and the index; the api LLD must use them.
- **Live-events publish failure mode.** Per Hand-Off Risk §Live-events publish ordering, a Kafka publish failure does NOT throw out of handle — the DB write has already committed and is the source of truth. The cost is one missed tick, observable via Sentry. The publish IS awaited but the publisher swallows its own errors internally. This is intentional and locked.
- **Migration numbering.** Phase A is now merged on `main` with `0001_init` plus `0002_inference_trace_index`. This LLD's migration is `0003_phase_b_kind_enum`. Task 1b is the explicit verification step; if `main` advances further before build, bump the prefix and update every reference.
- **`@updatedAt` is Prisma-client-managed.** Task 20 is the raw-SQL audit. The api LLD owner must keep their stream-progress tick on the PrismaClient path; if any raw `UPDATE inferences` is added, the janitor predicate will skew silently.
- **Snake_case payload is the contract.** Task 2 is the regression guard. Drift between contracts and workers is caught at CI time; do not let any worker code construct the payload with camelCase keys.

## Reviewer Concerns

Codex v2 review (5/10) surfaced these unresolved items after 2 review iterations per /oh discipline. Builder absorbs during execution:

- **6 tasks still mildly oversized** (1a, 5, 15, 31, 32, 39c) — split into smaller commits during execution if any single task exceeds 5 min.
- **Heartbeat zero-event spans idempotency** (real design gap) — heartbeat spans typically have no `span.events`, but the mapper creates `trace_events` rows from events. Either heartbeat emitter (in api LLD) must carry at least one event, or the consumer must create a heartbeat-row even when `span.events` is empty. Coordinate with backend-api LLD's heartbeat scheduler task.
- **`packages/db/jest.config` extension** — Task 1a creates `.ts` but repo convention is `.js`. Use `.js`.
- **`packages/contracts` has no Jest config** — Task 2's contract test needs `packages/contracts/jest.config.js` as a prerequisite. The package has Jest deps but no config currently.
- **`InferenceKind` export from `@argus/db`** — `packages/db/src/index.ts` has an explicit named-type re-export list. The plan's "no changes needed" claim is wrong; add `InferenceKind` to the export list.
- **Publisher constructor DI contradiction** — Task 32 says both "takes injected `Kafka` client" AND "constructs from env". Pick one. Default: injected via Nest provider that reads env.
- **Task 13 GREEN leaves Task 12 RED partially failing** — pairing violation. Split Task 12 into cascade-only and session-pointer RED tasks.
- **Index tests on 3 new FK columns** — `classifier_for_message_id`, `replay_of_inference_id`, `sample_workspace_id` have indexes per the migration but no RED test asserts they exist.
- **Format violations remain in some test acceptance lines** — exact assertion mechanics still appear in a few places. Convert to behavioral prose when touching those tasks.
- **OTLP smoke endpoint underspecified** (Task 39c) — name the exact Collector OTLP endpoint, content-type, and payload encoding.
