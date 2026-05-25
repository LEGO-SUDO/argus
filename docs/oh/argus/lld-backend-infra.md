---
phase: lld
status: APPROVED
slug: argus
scope: phase-a
domain: backend-infra
builder: backend-infra-worker
created: 2026-05-23
updated: 2026-05-23
---

# LLD: backend-infra — Argus Phase A

Scope of this LLD: the persistence-and-ingestion spine that Phase B reads from. Specifically:
- Prisma schema + initial migration for the five core tables plus the `trace_events` projection table (HLD D4).
- The Redpanda → projection-consumer pipeline (`apps/workers/src/projection/*`) that enriches the gateway-inserted `inferences` placeholder row keyed on `message_id` and writes raw span detail to `trace_events` (HLD D1).
- The compose topology: seven services, healthcheck-gated boot, no Redis in Phase A (HLD D7).
- The OTel Collector config that fan-outs OTLP to both Redpanda and Jaeger (HLD §Observability).
- The Redpanda topic bootstrap that creates the `traces` topic. Spans for one chat turn co-locate via trace-id partitioning (see Task §Collector + the Hand-Off Risk section below for the resolution of the Codex partition-key concern).
- `.env.example` defaults that make `MOCK_PROVIDER=true` the keyless boot path (HLD §forward-compat + PRD §Constraints).

**Explicitly out of scope (Phase B):** BullMQ workers, cost rollup job, replay engine, Redis service, `pricing` table migrations.

**Ownership boundary (load-bearing):** the projection consumer is a *reader and enricher*, never an authority. It **never writes `messages.status`** — that column is owned synchronously by the API gateway (HLD §Component Map). The consumer's only writes are: (a) update existing `inferences` row by `message_id`, (b) insert additional `inferences` rows for failover attempts linked by `message_id`, (c) insert `trace_events` rows idempotent on `(trace_id, span_id)`.

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

The workspace touched by this LLD is the TypeScript monorepo (pnpm 10.33.3 + Turborepo). New and edited paths fall into four buckets:

- **Prisma package (`packages/db/`):** edits `prisma/schema.prisma` (currently empty of models); creates `prisma/migrations/0001_init/migration.sql` and `prisma/migrations/migration_lock.toml`; edits `src/index.ts` for the PrismaClient singleton export.
- **Workers app (`apps/workers/`):** edits `src/main.ts` and `src/app.module.ts` (currently scaffolded as a Nest application context); creates `src/projection/projection.module.ts`, `src/projection/projection.consumer.ts`, `src/projection/projection.service.ts`, `src/projection/span-mapper.ts`, `src/projection/failover-detector.ts`, `src/projection/payload-cap.ts`, `src/projection/types.ts`; creates `src/health/health.controller.ts` and `src/health/health.module.ts`; creates the test helpers folder `test/helpers/prisma-testcontainer.ts`; creates the unit test files `test/span-mapper.test.ts`, `test/failover-detector.test.ts`, `test/payload-cap.test.ts`; creates the integration test file `test/projection.service.integration.test.ts`; creates the static-boundary lint test `test/no-messages-delegate.test.ts`; creates `Dockerfile`.
- **Infra (`infra/`):** edits `compose/docker-compose.yml` (skeleton already lists 7 stubbed services with real configs commented inline — this LLD uncomments and finalises them); edits `otel/collector.yaml` (skeleton has working OTLP receiver and commented kafka/jaeger exporters — this LLD enables them); edits `redpanda/topics.sh` (header-only stub); creates `redpanda/Dockerfile.bootstrap`; creates `postgres/init.sql`.
- **Root config:** creates `.env.example`; edits root `package.json` to add `pnpm.onlyBuiltDependencies` (so Prisma's lifecycle scripts run inside Docker build).

Note: there is no separate `idempotency-guard.ts` file — the duplicate-span detection is implemented as the catch-on-unique-violation pattern inside `projection.service.ts` (see Hand-Off Risk §Idempotency ownership below for the rationale).

Quality-gate commands (pnpm 10.33.3 monorepo, script names match the actual scaffold):
- typecheck: `pnpm -r typecheck`
- lint: `pnpm -r lint`
- test: `pnpm -r test`
- compose smoke: `docker compose -f infra/compose/docker-compose.yml up -d --wait`

## Open Questions

Logged but not blocking:

1. **`trace_events` payload column type.** HLD says full I/O JSON, capped 100KB per OTel **span event** (not attribute). Open: store as `Jsonb` (queryable, but Postgres TOAST overhead) vs `Bytea` (opaque, faster scans). *Default I will instruct:* `Jsonb` — Phase B Replay needs to read fields without rehydration, and the 100KB cap bounds bloat.
2. **`error_code` enum vs free-text.** HLD lists `client_disconnected` as one value but doesn't enumerate the full set. *Default I will instruct:* free-text `String?` column for Phase A (avoids migration when adapters add new codes); README documents the canonical set. The `messages.error_code` column is the one backend-api LLD reads/writes.
3. **Redpanda single-node mode for compose.** Redpanda supports a single-broker dev mode (`--mode dev-container`). *Default I will instruct:* dev-container mode in compose; documented in README as "swap to 3-broker cluster in prod."
4. **Migration tool.** Prisma Migrate vs raw SQL. *Default I will instruct:* `prisma migrate deploy` on API boot (one tool, one DSL, integrates with Prisma Client); the migration SQL file is checked in so reviewers see the schema delta diff. Integration tests use the same `prisma migrate deploy` path against a testcontainer.
5. **Consumer group id.** Single group `argus-projection` so all consumer replicas coordinate. *Default I will instruct:* yes, with `enable.auto.commit=false` and manual commit after successful DB write (at-least-once + DB unique constraint = effectively-once).

## Hand-Off Risk Resolutions

These are decisions the LLD owns explicitly to remove ambiguity for the builder.

### Collector Kafka partition-key — resolution of Codex §5 concern

The OTel Collector contrib Kafka exporter does **not** support partitioning by a span attribute or resource attribute. The supported options are:
- `partition_traces_by_id: true` — uses `trace_id` as the Kafka record key (sticky-key partitioner ensures co-location)
- `traces.message_key_from_metadata_key` — uses a client-metadata header (not a span attribute), mutually exclusive with the above

HLD D1 requires that "all spans for one turn land on the same partition, ordered." Per HLD D1 + D3, one chat turn corresponds to one root span the SDK opens (with all provider/router child spans nested under it), so **one turn == one `trace_id`**. Setting `partition_traces_by_id: true` therefore satisfies HLD D1 with the smallest deviation from the original text — the LLD adjusts the Scope section above to say "via trace-id partitioning" rather than "via message-id partitioning," and the projection consumer reads `message_id` from the span attributes as it always did (partitioning vs identity are independent concerns). Documented in the collector config task.

### Idempotency insert ownership — resolution of Codex §5 concern

There is **one writer** of `trace_events` rows: `ProjectionService.handle`. There is no separate `idempotency-guard.ts` helper. The guard is the database's `UNIQUE(trace_id, span_id)` constraint. The ordering inside `handle` is **fixed and load-bearing**:

1. Begin Prisma transaction.
2. Attempt the `trace_events` INSERT first. If it succeeds, continue. If it raises Prisma error `P2002` (unique violation), the whole `handle` returns success with zero side effects (no `inferences` mutation, no other writes) — the transaction rolls back.
3. Load existing `inferences` rows for `message_id`, run `decideInferenceWrite`, perform the `update` / `create`.
4. Commit.

This eliminates the double-insert ambiguity Codex flagged: the `trace_events` insert is both the dedupe check and the durable write. A duplicate delivery cannot re-stomp an updated inference because the early-return happens before the inference load.

### Contracts dependency gate

`packages/contracts` is currently a placeholder. Task 0 of this LLD is a preflight check that blocks the rest of the plan if the contracts package has not exposed the OTLP span shape and projection row shapes. The builder waits, does not invent the shapes here.

### Dockerfile pnpm-workspace constraints

The workers Dockerfile uses a multi-stage build with the exact COPY order: (1) root `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`; (2) every `packages/*/package.json` and `apps/workers/package.json`; (3) `pnpm install --frozen-lockfile`; (4) source for `packages/contracts`, `packages/db`, `packages/sdk`, `apps/workers`; (5) `pnpm --filter @argus/workers build`. Runtime stage copies `dist`, `node_modules`, and Prisma's generated client. The root `pnpm.onlyBuiltDependencies` allowlist (Task 1) lets Prisma generate without prompting.

### Compose ownership boundary

This LLD finalises only the infra-owned compose services (`postgres`, `redpanda`, `redpanda-bootstrap`, `otel-collector`, `jaeger`, `workers`). The `web` and `api` services remain in skeleton form here — their build/healthcheck blocks are filled in by the frontend-web and backend-api LLDs respectively. Task 28 (final assembly) only validates that all seven services compose-validate together and depends_on chains resolve; it does not author `web` or `api` build blocks.

## Tasks

Task numbering convention: RED tasks pair with the immediately following GREEN task. Smoke and infra tasks are labelled `[non-TDD — <reason>]`.

---

### Task 0: [non-TDD — preflight dependency gate] Verify contracts package exposes required types

**Files:** read-only check against `packages/contracts/src/index.ts`
**What to do:** Confirm the contracts package exports an OTLP span type, a projection-row mutation type for `inferences`, and a row-shape type for `trace_events`. If absent, stop and surface a blocking signal to the orchestrator — do not invent the shapes in this LLD's surface.
**Acceptance:** A grep over `packages/contracts/src/index.ts` finds exported symbol names corresponding to the OTLP span, the inference projection row, and the trace event row. If any is missing, the task fails and the LLD halts before Task 4.
**Verify:** `grep -E "OtlpSpan|InferenceProjection|TraceEventRow" packages/contracts/src/index.ts` returns at least three matches.

---

### Task 1: [non-TDD — root pnpm config] Add pnpm `onlyBuiltDependencies` allowlist

**Files:** root `package.json`
**What to do:** Add a `pnpm.onlyBuiltDependencies` array containing `@nestjs/core`, `@prisma/client`, `@prisma/engines`, `prisma`, and `unrs-resolver` so pnpm runs their lifecycle scripts during install (required for Prisma client generation in Docker build). Coordinate with the scaffolder's noted blocked list.
**Acceptance:** Field exists with the five entries; `pnpm install` runs to completion without the "Ignored build scripts" warning for the listed packages.
**Verify:** `pnpm install` exits 0 and stderr does not match `Ignored build scripts: @prisma/client`.

---

### Task 2: [non-TDD — Prisma schema authoring] Author the six-model schema

**Files:** `packages/db/prisma/schema.prisma`
**What to do:** Define six Prisma models (`User`, `Session`, `Conversation`, `Message`, `Inference`, `TraceEvent`) and two Prisma enums (`MessageStatus`, `InferenceStatus`). Decisions to encode:
- **IDs:** `String @id` with `@default(uuid())` for all six models (UUID v4 strings).
- **Timestamps:** `createdAt DateTime @default(now())` on every model; `updatedAt DateTime @updatedAt` on `Conversation`, `Message`, `Inference`.
- **Cost columns:** `BigInt` for `promptCostUsdMicros` and `completionCostUsdMicros` on `Inference`; document in a schema comment that the app layer serialises BigInt as string at the API boundary (Prisma returns JS BigInt).
- **`messages.errorCode`:** `String?` (nullable, free-text per Open Question §2) — backend-api LLD reads/writes this column.
- **`trace_events.payload`:** `Json` (Prisma's `Jsonb` mapping on Postgres).
- **`trace_events.replayable`:** `Boolean @default(true)` — set to `false` by the projection consumer when payload-cap truncation occurs (HLD §forward-compat for Phase B Replay).
- **Enums:** `MessageStatus { streaming complete canceled failed }` with `@@map("message_status")`; `InferenceStatus { streaming complete failed }` with `@@map("inference_status")`. Each enum value gets `@map("...")` to a snake_case DB literal.
- **Relations + cascade:** `Conversation -> User` is `onDelete: Restrict`; `Message -> Conversation` is `onDelete: Cascade`; `Inference -> Message` is `onDelete: Cascade`; `Session -> User` is `onDelete: Cascade`; `TraceEvent` has no relation to messages (denormalised user_id only — Phase B query path).
- **Nullability:** `Message.content`, `Message.completedAt`, `Message.errorCode` nullable; `Inference.completionTokens`, `Inference.promptTokens`, `Inference.latencyMs`, `Inference.endedAt`, `Inference.errorCode`, `Inference.outputPreview` nullable (placeholder row inserted by gateway has null tokens until enrichment); `TraceEvent.payload` not null.
- **Indexes:** `(userId, createdAt(sort: Desc))` on both `Inference` and `TraceEvent`; `(conversationId, createdAt)` on `Message`; `(messageId)` regular index on `Inference` (NOT unique — failover-attempt rows share `messageId`); `(traceId, spanId)` unique index on `TraceEvent`.
- **Map names:** every model has `@@map("snake_case_table_name")` so DB column/table names are conventional.

**Acceptance:** `prisma format` rewrites with no diff; `prisma validate` exits 0; the file declares exactly six models and two enums; the `trace_events` model carries the `UNIQUE(trace_id, span_id)` and the `replayable` boolean; the cost columns are typed `BigInt`.
**Verify:** `pnpm --filter @argus/db exec prisma format && pnpm --filter @argus/db exec prisma validate`.

---

### Task 3: [non-TDD — generated migration artifact] Generate initial migration

**Files:** `packages/db/prisma/migrations/0001_init/migration.sql`, `packages/db/prisma/migrations/migration_lock.toml`
**What to do:** Run `prisma migrate dev --name init --create-only` against a throwaway local Postgres to generate the `0001_init/migration.sql`; commit it. Do not apply interactively here — apply happens via `prisma migrate deploy` on `api` boot (and the integration-test factory in Task 14).
**Acceptance:** `migration.sql` exists; contains six `CREATE TABLE` statements (one per model) and two `CREATE TYPE` for the enums; the trace_events `UNIQUE` constraint on `(trace_id, span_id)` is present; cost columns are `BIGINT`; `migration_lock.toml` pins provider `postgresql`.
**Verify:** `grep -c "CREATE TABLE" packages/db/prisma/migrations/0001_init/migration.sql` returns `6` and `grep -E "UNIQUE.*trace_id.*span_id" packages/db/prisma/migrations/0001_init/migration.sql` matches.

---

### Task 4: [non-TDD — PrismaClient package export] Export PrismaClient singleton

**Files:** `packages/db/src/index.ts`
**What to do:** Export a lazily-instantiated `PrismaClient` singleton (one per Node process), re-export Prisma's generated types and enums. The workspace package and tsconfig already exist from the scaffold.
**Acceptance:** A simple importer in `apps/workers` can `import { prisma, MessageStatus, InferenceStatus } from '@argus/db'`; `pnpm --filter @argus/db typecheck` is clean.
**Verify:** `pnpm --filter @argus/db typecheck`.

---

### Task 5 (RED): Failing test for span-mapper happy path

**Files:** `apps/workers/test/span-mapper.test.ts`
**What to do:** Write a failing test that imports `mapSpanToProjection` from `apps/workers/src/projection/span-mapper.ts` (not yet present) and verifies the happy-path behavior: given a representative OTLP span carrying the standard `llm.*` attributes, the SDK-attached cost-snapshot attributes, the conversation/user/message/turn identifiers, and one input and one output span event, the mapper returns a structured verdict describing both an `inferences` mutation and a `trace_events` insert. Name the behaviour ("mapper produces both an inference mutation and a trace-event insert from a well-formed span"), not the exact assertion field list.
**Acceptance:** The test exists, runs, and fails because the symbol is unresolved.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.test.ts` fails with the expected reason.

---

### Task 6 (GREEN): Implement span-mapper happy path

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Implement `mapSpanToProjection` as a pure function over a parsed OTLP span (shape from `@argus/contracts`) returning a discriminated verdict describing one `inferences` row mutation plus one `trace_events` insert. The mapper does not re-derive cost — it reads `llm.prompt_cost_usd_micros` and `llm.completion_cost_usd_micros` from the span attributes that the SDK attached at instrumentation time.
**Acceptance:** Task 5 test passes; no other tests break.
**Verify:** `pnpm --filter @argus/workers test && pnpm --filter @argus/workers typecheck`.

---

### Task 7 (RED): Failing test for span-mapper — failed/error span branch

**Files:** Append to `apps/workers/test/span-mapper.test.ts`
**What to do:** Add a failing test case for the failed-span branch: an OTLP span with `llm.status=error`, an `error_code` attribute, and null/partial token counts. The mapper should return a verdict that produces an `inferences` mutation marked as failed status with whatever token data is present, plus a `trace_events` insert. Name the behaviour, not the assertion shape.
**Acceptance:** New case fails because the current mapper only handles the `ok` branch.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.test.ts` fails on the new case.

---

### Task 8 (GREEN): Extend span-mapper to handle failed spans

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Branch the mapper on `llm.status`, propagate `error_code` through to the inference verdict, and tolerate null/missing token fields without throwing.
**Acceptance:** Tasks 5 and 7 both pass; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 9 (RED): Failing test for span-mapper — missing required attributes (poison-pill)

**Files:** Append to `apps/workers/test/span-mapper.test.ts`
**What to do:** Add a failing test case for malformed spans: a span missing `message.id`, a span missing `user.id`, and a span missing `llm.provider`. The mapper should return a discriminated "reject" verdict (do not throw, do not poison-loop) carrying the reason; the projection service will use this to skip the record without committing offset failure.
**Acceptance:** New cases fail because the current mapper does not have a reject branch.
**Verify:** `pnpm --filter @argus/workers test test/span-mapper.test.ts` fails on the new cases.

---

### Task 10 (GREEN): Add reject branch to span-mapper

**Files:** `apps/workers/src/projection/span-mapper.ts`
**What to do:** Add a reject verdict for malformed spans (missing required identifying attributes). Reject is observable, not silent.
**Acceptance:** All span-mapper tests pass; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 11 (RED): Failing test for failover-detector — three cases

**Files:** `apps/workers/test/failover-detector.test.ts`
**What to do:** Write a failing test for `decideInferenceWrite` covering three cases: (a) no existing `inferences` rows for the `message_id` → verdict "insert-placeholder-missing" (recoverable but logged warning); (b) existing row with `status=streaming` and same `provider` as incoming span → verdict "update-in-place"; (c) existing row with `status=failed` and *different* `provider` from incoming span → verdict "insert-failover-attempt". Name the behaviours, not the verdict object shapes.
**Acceptance:** Test fails for unresolved import of `decideInferenceWrite`.
**Verify:** `pnpm --filter @argus/workers test test/failover-detector.test.ts` fails with the expected reason.

---

### Task 12 (GREEN): Implement failover-detector

**Files:** `apps/workers/src/projection/failover-detector.ts`
**What to do:** Implement `decideInferenceWrite` as a pure function over `(existingRowsForMessageId, incomingSpan)` returning a discriminated verdict per the three cases. Ordering by `started_at desc` decides which existing row "matches" by provider.
**Acceptance:** Task 11 test passes; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 13 (RED): Failing test for failover-detector — extra edge cases

**Files:** Append to `apps/workers/test/failover-detector.test.ts`
**What to do:** Add failing test cases for two cases Task 11 didn't cover: (d) existing row with `status=failed` and **same** provider as incoming span — verdict is "update-in-place" (a retry of the same provider after a failure is still an update, not a new attempt); (e) existing row with `status=complete` and **different** provider as incoming span — verdict is "insert-failover-attempt" (rare race where a late span arrives for a previously-failed attempt after a successful one was recorded).
**Acceptance:** New cases fail because the current detector does not distinguish these.
**Verify:** `pnpm --filter @argus/workers test test/failover-detector.test.ts` fails on the new cases.

---

### Task 14 (GREEN): Extend failover-detector for edge cases

**Files:** `apps/workers/src/projection/failover-detector.ts`
**What to do:** Refine the matching rules so (d) and (e) resolve correctly. Keep the function pure.
**Acceptance:** All failover-detector tests pass; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 15 (RED): Failing test for payload-cap — under, over, marker

**Files:** `apps/workers/test/payload-cap.test.ts`
**What to do:** Write a failing test for `capSpanEventPayload` covering: (a) under-100KB payload passes through with `truncated: false`; (b) over-100KB payload is truncated to a byte count under the cap and the returned shape carries `truncated: true` plus a sentinel naming the original byte count; (c) the over-cap case flags the result as non-replayable. Name the behaviours.
**Acceptance:** Test fails for unresolved import of `capSpanEventPayload`.
**Verify:** `pnpm --filter @argus/workers test test/payload-cap.test.ts` fails with the expected reason.

---

### Task 16 (GREEN): Implement payload-cap

**Files:** `apps/workers/src/projection/payload-cap.ts`
**What to do:** Implement `capSpanEventPayload` to measure UTF-8 byte length of the serialised payload, return as-is when under 100KB, otherwise truncate to a safe boundary (≤95KB to leave headroom for the marker), append a sentinel field carrying the original byte length, and mark the result non-replayable.
**Acceptance:** Task 15 test passes; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 17: [non-TDD — testcontainer helper] Author Prisma testcontainer factory

**Files:** `apps/workers/test/helpers/prisma-testcontainer.ts`
**What to do:** Provide a helper that, per test file, starts a `postgres:16-alpine` container via `@testcontainers/postgresql`, runs `prisma migrate deploy` against it, and returns a `PrismaClient` plus a teardown function. Per-test isolation uses an explicit `BEGIN; ... ROLLBACK;` wrapper or a `TRUNCATE` reset between tests — pick whichever the integration test author wants but document the choice in a header comment.
**Acceptance:** Importing the helper from a smoke test file, calling `setup()`, and running `await prisma.user.count()` returns `0` without error.
**Verify:** A trivial smoke test importing the helper passes; `pnpm --filter @argus/workers test test/helpers/` exits 0.

---

### Task 18 (RED): Failing integration test — single span end-to-end

**Files:** `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Using the testcontainer helper from Task 17, write a failing integration test that seeds one `inferences` placeholder row (status=streaming, null tokens) under a known `message_id` linked to a fake user and conversation, then invokes `ProjectionService.handle(span)` with one fabricated OTLP span carrying the matching `message_id`. The test verifies the load-bearing ownership boundary from HLD §Component Map: the inference row is enriched, a trace_events row exists, and `messages.status` is not touched (the test creates no `messages` row at setup to make this observable).
**Acceptance:** Test fails for unresolved import of `ProjectionService` or undefined `handle`.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails with the expected reason.

---

### Task 19 (GREEN): Implement ProjectionService.handle — happy path

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** Implement `handle(span)` following the load-bearing order documented in Hand-Off Risk §Idempotency ownership: open a Prisma transaction, attempt the `trace_events` INSERT first (catch `P2002` → early return), then load existing `inferences` rows for `message_id`, run `decideInferenceWrite`, write via Prisma `update` or `create`, commit. The service never references the Prisma `message` delegate.
**Acceptance:** Task 18 test passes; no other tests break.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 20 (RED): Failing static-boundary test — no messages-delegate reference

**Files:** `apps/workers/test/no-messages-delegate.test.ts`
**What to do:** Write a failing test that reads the text of `apps/workers/src/projection/projection.service.ts` and asserts the file does not contain any reference to `prisma.message` or `prisma.messages` (the Prisma client's delegate names). This is the enforceable replacement for the "lint comment" suggestion the original LLD made — it prevents silent regression of the HLD §Component Map ownership boundary.
**Acceptance:** Test fails when written against the current `projection.service.ts` (if the file accidentally contains `prisma.message`), or passes immediately if the file is clean.
**Verify:** `pnpm --filter @argus/workers test test/no-messages-delegate.test.ts` runs.

---

### Task 21 (GREEN): Make the boundary check pass

**Files:** `apps/workers/src/projection/projection.service.ts` (no-op if Task 19 already left it clean)
**What to do:** If Task 19's implementation accidentally referenced the messages delegate, remove the reference. Otherwise the test passes immediately.
**Acceptance:** Task 20 test passes.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 22 (RED): Failing integration test — duplicate-delivery idempotency + no inference re-stomp

**Files:** Append a new test case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Add a failing test case that calls `handle(span)` twice with the **same span**, with a twist: between the two calls, mutate the second span's token counts to different values. After both calls, assert exactly one `trace_events` row exists and the `inferences` row contains the values from the first call only (re-application cannot re-stomp). This directly exercises the load-bearing ordering from Hand-Off Risk §Idempotency ownership (trace_events insert first, inference mutation second).
**Acceptance:** Case fails because the current `handle` implementation has not yet enforced the early-return on duplicate.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new case.

---

### Task 23 (GREEN): Enforce early-return on duplicate trace_event insert

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** Ensure the `P2002`-catch path returns from `handle` before any `inferences` work — the trace_events insert is the gate, not a side step.
**Acceptance:** Task 22 case passes; Task 18 still passes.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 24 (RED): Failing integration test — failover-attempt linkage

**Files:** Append a new test case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Seed an existing `inferences` row with `status=failed` and `provider=openai` under a known `message_id`, then invoke `handle` with a span for the same `message_id` carrying `provider=anthropic` and `status=ok`. Assert the database now holds two `inferences` rows for that `message_id` — the failed openai attempt unchanged, plus the new anthropic completion row — both with the same `message_id` and `user_id`.
**Acceptance:** Case fails because the current `handle` only updates in place — it does not branch on the failover verdict.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new case.

---

### Task 25 (GREEN): Branch ProjectionService on failover verdict

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** Switch `handle` on the `decideInferenceWrite` verdict so `update-in-place` calls Prisma `update` and `insert-failover-attempt` calls Prisma `create` with a fresh `id` and the same `message_id` / `user_id` / `conversation_id`.
**Acceptance:** Task 24 case passes; Tasks 18 and 22 still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 26 (RED): Failing integration test — payload-cap end-to-end produces non-replayable trace_event

**Files:** Append a new test case to `apps/workers/test/projection.service.integration.test.ts`
**What to do:** Invoke `handle(span)` with a span whose `llm.output` span event carries a payload over 100KB. Assert the resulting `trace_events` row is flagged `replayable=false` and the payload is truncated. This exercises the integration of `payload-cap.ts` with `projection.service.ts` end-to-end — Task 15 covered the unit, this covers the wire-through.
**Acceptance:** Case fails because `projection.service.ts` has not yet invoked `capSpanEventPayload` and propagated the `replayable` flag.
**Verify:** `pnpm --filter @argus/workers test test/projection.service.integration.test.ts` fails on the new case.

---

### Task 27 (GREEN): Wire payload-cap into projection service

**Files:** `apps/workers/src/projection/projection.service.ts`
**What to do:** Apply `capSpanEventPayload` to each span event payload before insert; propagate the `replayable` flag onto the `trace_events` row.
**Acceptance:** Task 26 case passes; all prior tests still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 28: [non-TDD — kafkajs consumer shell] Register ProjectionConsumer module + module wiring

**Files:** `apps/workers/src/projection/projection.module.ts`, `apps/workers/src/projection/projection.consumer.ts`, `apps/workers/src/app.module.ts`
**What to do:** Create the Nest module that provides `ProjectionService` and registers `ProjectionConsumer` as an injectable with lifecycle hooks (`OnModuleInit` / `OnApplicationShutdown`). The consumer constructor takes a kafkajs `Kafka` client created from env-driven brokers list; it does not subscribe yet. Wire the module into `AppModule`. Add `kafkajs` and `@opentelemetry/otlp-transformer` to `apps/workers/package.json` dependencies.
**Acceptance:** `pnpm --filter @argus/workers build` exits 0; the compiled bundle includes both new files.
**Verify:** `pnpm --filter @argus/workers build`.

---

### Task 29: [non-TDD — OTLP decode] OTLP protobuf record decode

**Files:** `apps/workers/src/projection/projection.consumer.ts`
**What to do:** Implement a `decodeOtlpRecord(buffer)` helper using `@opentelemetry/otlp-transformer` that parses the raw Kafka message value into the typed OTLP `TracesData` shape, then walks resource-spans → scope-spans → spans, yielding one normalised span per emit. The yielded span is the shape `mapSpanToProjection` consumes.
**Acceptance:** A trivial unit smoke that feeds a hand-built protobuf buffer (or a fixture file under `apps/workers/test/fixtures/otlp-record.bin`) returns one span with the expected `traceId` and `spanId`.
**Verify:** `pnpm --filter @argus/workers test test/otlp-decode.test.ts` exits 0 (the test file is part of this task).

---

### Task 30 (RED): Failing test — kafka consumer commits offset only on success

**Files:** `apps/workers/test/projection.consumer.test.ts`
**What to do:** Write a failing test using a mocked `kafkajs.Consumer` that verifies: (a) when `handle` resolves, the consumer's `commitOffsets` method is called with the matching offset; (b) when `handle` throws, `commitOffsets` is NOT called. This is the load-bearing at-least-once observable behavior.
**Acceptance:** Test fails because the consumer's eachBatch handler does not yet exist or does not yet wire commit semantics.
**Verify:** `pnpm --filter @argus/workers test test/projection.consumer.test.ts` fails with the expected reason.

---

### Task 31 (GREEN): Implement kafka consumer batch + commit semantics

**Files:** `apps/workers/src/projection/projection.consumer.ts`
**What to do:** Subscribe to the `traces` topic with consumer group `argus-projection`, `enable.auto.commit=false`. In the `eachBatch` callback: decode each record into spans (Task 29), call `ProjectionService.handle(span)` per span, then call `commitOffsets` only after all spans in the batch resolve; on any throw, do not commit (kafkajs will redeliver). Errors bubble — no silent swallow.
**Acceptance:** Task 30 test passes; existing tests still pass.
**Verify:** `pnpm --filter @argus/workers test`.

---

### Task 32: [non-TDD — manual smoke for consumer] Live consumer smoke against compose

**Files:** No new source files; uses compose + `rpk topic produce`
**What to do:** With compose running, produce one fabricated OTLP record to the `traces` topic via `rpk topic produce`. Confirm one `trace_events` row appears within 2 seconds and consumer-group lag drops to zero (visible via `rpk group describe argus-projection`).
**Acceptance:** `psql -c "SELECT COUNT(*) FROM trace_events"` returns 1 within 2 seconds of the produce; `rpk group describe argus-projection` shows lag 0.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait` then the documented `rpk topic produce` + `psql` sequence.

---

### Task 33: [non-TDD — Nest bootstrap + health endpoint] Workers bootstrap with `/healthz` (positive + negative)

**Files:** `apps/workers/src/main.ts`, `apps/workers/src/health/health.controller.ts`, `apps/workers/src/health/health.module.ts`, `apps/workers/src/app.module.ts`
**What to do:** Convert the workers bootstrap from `createApplicationContext` to `NestFactory.create` so an HTTP server starts on `${PORT:-3002}`. Register `HealthModule`. The `/healthz` controller returns 200 only when the kafkajs consumer reports `isRunning()===true` AND a `SELECT 1` via Prisma resolves within 200ms; on either failure it returns 503 with a JSON body naming which check failed. The health controller injects both `ProjectionConsumer` and `PrismaClient` to perform these checks.
**Acceptance:** `curl http://localhost:3002/healthz` returns 200 when compose is healthy; stopping the postgres container and curling within 5 seconds returns 503 with `{"db":"down"}` in the body; stopping redpanda returns 503 with `{"kafka":"down"}`.
**Verify:** `curl -fsS http://localhost:3002/healthz` (positive) and a manual `docker compose stop postgres && curl -fsS http://localhost:3002/healthz; echo $?` showing exit code 22 (HTTP error from curl `-f`).

---

### Task 34: [non-TDD — Workers Dockerfile] Multi-stage pnpm-workspace build

**Files:** `apps/workers/Dockerfile`
**What to do:** Author a multi-stage Dockerfile honouring the pnpm-workspace constraints documented in Hand-Off Risk §Dockerfile pnpm-workspace constraints (build context is the repo root): builder stage installs `corepack enable && corepack prepare pnpm@10.33.3 --activate`, COPYs root `pnpm-lock.yaml` + `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` + `turbo.json`, COPYs every `packages/*/package.json` and `apps/workers/package.json`, runs `pnpm install --frozen-lockfile`, COPYs source for the four involved packages, runs `pnpm --filter @argus/db exec prisma generate && pnpm --filter @argus/workers build`. Runtime stage is `node:20-alpine`, copies `dist`, `node_modules`, and the generated Prisma client, runs as a non-root user, `CMD ["node", "dist/main.js"]`.
**Acceptance:** `docker build -t argus-workers -f apps/workers/Dockerfile .` from the repo root exits 0; the resulting image runs and serves `/healthz` (when env points at a reachable Postgres + Redpanda).
**Verify:** `docker build -t argus-workers -f apps/workers/Dockerfile .`.

---

### Task 35: [non-TDD — Postgres compose service] Postgres service

**Files:** `infra/compose/docker-compose.yml`, `infra/postgres/init.sql`
**What to do:** Uncomment / finalise the `postgres` service in compose using `postgres:16-alpine`, configure user `argus` / db `argus` via env, mount `infra/postgres/init.sql` as docker-entrypoint init, configure healthcheck `pg_isready -U argus`, persistent named volume `pg_data`. The 5432 port stays inside the compose network by default; README documents the host-binding swap for `psql` debugging.
**Acceptance:** `docker compose up postgres --wait` succeeds; `docker compose exec postgres pg_isready -U argus` exits 0.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait postgres`.

---

### Task 36: [non-TDD — Redpanda compose service] Redpanda service (pinned image)

**Files:** `infra/compose/docker-compose.yml`
**What to do:** Pin the `redpanda` service to `redpandadata/redpanda:v24.3.1` (or the current `v24.3.x` patch — verify against the Docker Hub tag list at build time), run in `--mode dev-container`, expose Kafka API on 9092 and admin on 9644 inside the compose network, healthcheck via `rpk cluster health -X admin.hosts=localhost:9644 --exit-when-healthy`, persistent volume `redpanda_data`.
**Acceptance:** `docker compose up redpanda --wait` resolves; `docker compose exec redpanda rpk cluster health` reports `Healthy: true`.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait redpanda`.

---

### Task 37: [non-TDD — Redpanda topic bootstrap] Create `traces` topic idempotently

**Files:** `infra/redpanda/topics.sh`, `infra/redpanda/Dockerfile.bootstrap`, `infra/compose/docker-compose.yml`
**What to do:** Fill out `topics.sh` to run `rpk topic create traces --partitions 6 --replicas 1` and treat "topic already exists" as exit 0. Package as a one-shot compose service `redpanda-bootstrap` depending on `redpanda` healthy, running the script and exiting. Partition-key enforcement is in the Collector exporter (Task 38), not here.
**Acceptance:** `docker compose up redpanda-bootstrap` runs to exit 0; `rpk topic list` includes `traces`; re-running compose up does not error.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up redpanda-bootstrap && docker compose exec redpanda rpk topic list`.

---

### Task 38: [non-TDD — Collector exporters + partition-key resolution] Author collector.yaml exporters

**Files:** `infra/otel/collector.yaml`
**What to do:** Uncomment / finalise the Kafka exporter targeting `redpanda:9092` topic `traces` with `partition_traces_by_id: true` (the verified-supported config that satisfies HLD D1 — see Hand-Off Risk §Collector Kafka partition-key for the rationale), `encoding: otlp_proto`, snappy compression. Uncomment / finalise the Jaeger exporter using `otlp/jaeger` to `jaeger:4317` with `tls.insecure: true`. The traces pipeline fans both exporters; remove the debug exporter from the pipeline (keep it defined for ad-hoc use). Add a comment block above the kafka exporter quoting the partition-key decision and pointing at this LLD's Hand-Off Risk section.
**Acceptance:** `yq` or `python -c "import yaml; yaml.safe_load(open('infra/otel/collector.yaml'))"` parses cleanly; the kafka exporter declares `partition_traces_by_id: true`; the pipeline `traces.exporters` lists both `kafka` and `otlp/jaeger`.
**Verify:** `python3 -c "import yaml; cfg=yaml.safe_load(open('infra/otel/collector.yaml')); assert cfg['exporters']['kafka']['partition_traces_by_id'] is True; assert set(cfg['service']['pipelines']['traces']['exporters']) == {'kafka', 'otlp/jaeger'}"`.

---

### Task 39: [non-TDD — Collector compose service + healthcheck] Add otel-collector service

**Files:** `infra/compose/docker-compose.yml`
**What to do:** Pin the `otel-collector` service to `otel/opentelemetry-collector-contrib:0.115.0` (or the current stable `0.115.x` patch — verify against Docker Hub), mount `infra/otel/collector.yaml` read-only at `/etc/otel/collector.yaml`, run with `--config=/etc/otel/collector.yaml`, expose 4317 + 4318 inside the compose network, healthcheck via HTTP GET on `:13133/` (the collector's built-in health_check extension — declare it in the collector.yaml too if not already present), depends_on `redpanda-bootstrap: service_completed_successfully`.
**Acceptance:** `docker compose up otel-collector --wait` resolves; the collector logs show both kafka and otlp/jaeger exporters initialised.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait otel-collector && curl -fsS http://localhost:13133/`.

---

### Task 40: [non-TDD — Collector partition-key live verification] Confirm trace-id partitioning works end-to-end

**Files:** No new files; uses compose + `rpk` + `curl`
**What to do:** With compose up, POST one synthetic OTLP span to `http://localhost:4318/v1/traces`. Verify a record appears on the `traces` topic via `rpk topic consume traces --num 1 --print-headers --print-keys`. Confirm the record key equals the trace-id hex string from the POST. Repeat with a different trace-id to confirm distinct partition assignment.
**Acceptance:** Two synthetic POSTs with two distinct trace-ids produce two records with two distinct keys; the keys match the trace-ids.
**Verify:** Documented two-curl + one-`rpk consume` shell sequence; output captured in the smoke-procedure section of the LLD-final README snippet (Task 47).

---

### Task 41: [non-TDD — Jaeger compose service] Jaeger all-in-one service (pinned image)

**Files:** `infra/compose/docker-compose.yml`
**What to do:** Pin the `jaeger` service to `jaegertracing/all-in-one:1.62.0` (or the current `1.62.x` patch — verify against Docker Hub; do not use Jaeger v2 yet — the contrib collector's `otlp/jaeger` exporter targets v1 cleanly), expose UI on 16686 host-bound, OTLP gRPC on 4317 + OTLP HTTP on 4318 inside compose, set `COLLECTOR_OTLP_ENABLED=true`, healthcheck via HTTP GET on `:14269/`.
**Acceptance:** `docker compose up jaeger --wait` resolves; `curl -fsS http://localhost:16686` returns Jaeger UI HTML.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait jaeger && curl -fsS http://localhost:16686 | grep -q Jaeger`.

---

### Task 42: [non-TDD — Workers compose service] Workers service uses the Dockerfile

**Files:** `infra/compose/docker-compose.yml`
**What to do:** Finalise the `workers` service: build context `../..` and dockerfile `apps/workers/Dockerfile`, env wiring (`DATABASE_URL`, `REDPANDA_BROKERS`, `PORT=3002`), depends_on `postgres: service_healthy` and `redpanda-bootstrap: service_completed_successfully`, healthcheck via the `/healthz` endpoint (Task 33).
**Acceptance:** `docker compose up workers --wait` resolves; `docker logs argus-workers-1` shows the Kafka-consumer-ready log line.
**Verify:** `docker compose -f infra/compose/docker-compose.yml up -d --wait workers`.

---

### Task 43: [non-TDD — full compose topology wiring] Assemble seven services, healthcheck-gated boot

**Files:** `infra/compose/docker-compose.yml`
**What to do:** Validation-only wiring step — no new service implementations. Confirm all seven long-running services plus the one-shot `redpanda-bootstrap` are present; declare `depends_on` chains: `redpanda-bootstrap` waits on `redpanda`, `otel-collector` waits on `redpanda-bootstrap` and `jaeger`, `workers` waits on `postgres` + `redpanda-bootstrap`, `api` waits on `postgres` (the api LLD authors the build/healthcheck block), `web` waits on `api` (the web LLD authors the build/healthcheck block). Confirm no `redis` service appears.
**Acceptance:** `docker compose config` validates; full `docker compose up -d --wait` brings all services to healthy on a warm cache; `docker compose ps` lists exactly 8 services (7 long-running + 1 exited oneshot); zero matches of `redis` in the rendered config.
**Verify:** `docker compose -f infra/compose/docker-compose.yml config && docker compose -f infra/compose/docker-compose.yml up -d --wait && docker compose -f infra/compose/docker-compose.yml config | grep -c redis` (expected 0).

---

### Task 44: [non-TDD — environment defaults] Author `.env.example`

**Files:** `.env.example`
**What to do:** Provide entries (each as a single `KEY=value` line with a leading comment) for: `DATABASE_URL` pointing at the compose postgres service; `REDPANDA_BROKERS=redpanda:9092`; `REDPANDA_TRACES_TOPIC=traces`; `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`; `JAEGER_QUERY_URL=http://localhost:16686`; `SESSION_SECRET=` (empty placeholder with comment "generate with `openssl rand -hex 32`"); `MOCK_PROVIDER=true`; empty slots for `OPENAI_API_KEY=`, `ANTHROPIC_API_KEY=`, `GOOGLE_API_KEY=` each preceded by a comment "leave unset to use mock provider". Header comment links to the README provider-setup section. No real secret values committed.
**Acceptance:** File exists; `grep -c "^MOCK_PROVIDER=true$" .env.example` returns 1; `grep -cE "API_KEY=$" .env.example` returns 3; no line matches `API_KEY=[^[:space:]#]`.
**Verify:** `test -f .env.example && grep -q "^MOCK_PROVIDER=true$" .env.example && ! grep -qE "API_KEY=[^[:space:]#]" .env.example`.

---

### Task 45 (RED): Failing static check — workers package has no `type-check` (typo) script

**Files:** `apps/workers/package.json`
**What to do:** Write a failing assertion (either a tiny Node check in `apps/workers/test/scripts.test.ts`, or a shell-grep entry in the verify command of this task) that the `scripts` block does NOT contain the key `"type-check"` and DOES contain the key `"typecheck"`. This is a guard rail against the original Codex finding that the LLD used the wrong script name everywhere.
**Acceptance:** Test or grep fails if someone re-adds a `type-check` script alias by mistake.
**Verify:** `node -e "const p=require('./apps/workers/package.json'); if(p.scripts['type-check']) process.exit(1); if(!p.scripts['typecheck']) process.exit(1)"`.

---

### Task 46 (GREEN): Confirm scripts pass the guard

**Files:** `apps/workers/package.json` (read-only if already correct)
**What to do:** No-op for the current scaffold (scripts are already `typecheck`). Task confirms the guard from Task 45 passes immediately.
**Acceptance:** Task 45 verify command exits 0.
**Verify:** Same as Task 45.

---

### Task 47: [non-TDD — README documentation only] Document the compose smoke procedure

**Files:** `apps/workers/README.md` (or extend repo root `README.md` if the smoke is repo-scoped — pick one; backend-infra LLD documents the projection-consumer smoke, not the full chat-turn smoke)
**What to do:** Add a "Phase A backend-infra smoke" section that names the exact shell sequence to validate the ingestion pipeline end-to-end without the chat surface: bring up compose, manually `INSERT` one `inferences` placeholder row via `psql`, publish one synthetic OTLP span via `curl` to `http://localhost:4318/v1/traces`, run two `psql` queries to confirm the inference row was enriched and the `trace_events` row exists, then check Jaeger UI shows the trace. Document the expected timing (under 5s end-to-end). Reference the Task 40 trace-id partitioning verification as a related but separate smoke.
**Acceptance:** README section exists at a predictable header (e.g. `## Phase A backend-infra smoke`); `grep -q "Phase A backend-infra smoke" apps/workers/README.md` returns 0.
**Verify:** `grep -q "Phase A backend-infra smoke" apps/workers/README.md`.

---

### Task 48: [non-TDD — end-to-end compose smoke RUN] Execute the documented smoke

**Files:** No new files; runs the procedure from Task 47
**What to do:** Run the documented sequence once against a fresh compose stack. Confirm the inference enrichment lands within 5s and the Jaeger UI shows the trace.
**Acceptance:** All assertions in the smoke procedure resolve (the inference row has non-null token counts and `trace_id`, the `trace_events` row exists with the same `message_id`, Jaeger UI shows the trace, and `messages.status` is unchanged because the smoke creates no `messages` row at setup).
**Verify:** Manual run of the Task 47 documented procedure; captured output attached to the PR description.

---

## Quality Gates

- typecheck: `pnpm -r typecheck`
- lint: `pnpm -r lint`
- test: `pnpm --filter @argus/workers test && pnpm --filter @argus/db test`
- compose smoke: `docker compose -f infra/compose/docker-compose.yml up -d --wait && docker compose ps`
- collector config validity: `python3 -c "import yaml; yaml.safe_load(open('infra/otel/collector.yaml'))"`

## Dependencies

- **`packages/contracts`** (authored by frontend/backend-api LLDs): the OTLP span shape, projection-row mutation type, and `trace_events` row shape must exist before Task 5 — Task 0 is the explicit preflight gate.
- **`packages/sdk`** (authored by backend-api LLD): the cost calculator attaches `llm.prompt_cost_usd_micros` / `llm.completion_cost_usd_micros` as span attributes; the projection consumer reads these directly. The OTel attribute schema in `packages/contracts` must declare these fields.
- **API gateway insert path** (backend-api LLD): the placeholder `inferences` row insert is owned there. This LLD's integration tests seed the row manually to stay domain-self-contained; the real handshake is exercised in the cross-domain compose smoke.
- **`messages.errorCode` column** (read/written by backend-api LLD): this LLD authors the column; the api LLD reads/writes it on stream-end/cancel/fail.

## Reviewer Concerns Addressed

The following Codex findings from `reviews/lld-backend-infra-codex.md` are addressed in this revision:

- §0 Format violations — all fenced blocks removed; assertion shapes softened to behaviour names.
- §0 Oversized tasks — Task 18 split into Tasks 28/29/30-31/32; Task 19 split into Tasks 33/34; Task 24 split into Tasks 38/39/40; Task 25 (now Task 43) reduced to wiring validation only; Task 27 (now Tasks 47/48) split README from execution.
- §1 Collector partition-key — resolved via `partition_traces_by_id: true` (HLD D1 satisfied through trace-id grouping; Hand-Off Risk §Collector Kafka partition-key explains the verified-supported config decision).
- §1 OTLP package + Redpanda encoding — Tasks 28 and 29 pin `@opentelemetry/otlp-transformer` and `kafkajs` as dependencies.
- §1 Contracts dependency — Task 0 is the explicit blocking gate.
- §1 Test factory file path — Task 17 names `apps/workers/test/helpers/prisma-testcontainer.ts`.
- §1 Dockerfile vagueness — Hand-Off Risk §Dockerfile pnpm-workspace constraints + Task 34 pin the COPY order.
- §2 README path mismatch — Task 47 pins the README path explicitly.
- §2 Offset commit observability — Tasks 30/31 RED-GREEN the commit-on-success-only behavior.
- §2 `/healthz` negative cases — Task 33 specifies positive + 503-with-failure-body acceptance.
- §3 Static boundary enforcement — Tasks 20/21 RED-GREEN the no-messages-delegate static check.
- §3 Missing-attribute / failed-span tests — Tasks 7-10 add failed and reject branches.
- §3 Payload-cap integration — Tasks 26/27 RED-GREEN the wire-through.
- §3 Kafka offset behavior — Tasks 30/31 as above.
- §3 Race re-stomp test — Task 22 explicitly mutates span tokens between calls.
- §3 Extra failover cases — Tasks 13/14 add same-provider-on-failed and different-provider-on-complete branches.
- §4 `typecheck` vs `type-check` — every command in this LLD uses `typecheck`; Tasks 45/46 add a regression guard.
- §4 Prisma command form — all Prisma invocations use `pnpm --filter @argus/db exec prisma <subcommand>`.
- §4 README path for Task 27 — fixed in Task 47.
- §5 Image pinning — Tasks 36, 39, 41 pin Redpanda, Collector, and Jaeger versions.
- §5 Idempotency ambiguity — resolved in Hand-Off Risk §Idempotency ownership; Tasks 19/22/23 enforce the load-bearing ordering.
- §5 Schema under-spec — Task 2 enumerates IDs, timestamps, cascades, enums, indexes, nullability, BigInt costs, the `errorCode` column, and the `replayable` boolean.
- §5 Compose ownership — Hand-Off Risk §Compose ownership boundary clarifies that `web` and `api` blocks belong to other LLDs; Task 43 only validates wiring.
- §5 Migration tool consistency — Open Question §4 commits to `prisma migrate deploy` everywhere (api boot + integration testcontainer).

## Reviewer Concerns NOT addressed (intentional)

- **HLD partition-key wording.** The HLD says "Redpanda topic is keyed by `message_id`." The LLD pivots to trace-id partitioning because the Collector Kafka exporter does not support attribute-keyed partitioning. HLD D1's correctness is preserved (spans for one turn co-locate) but the wording in HLD §D1 is now slightly stale. This is a doc-update follow-up the next HLD revision should pick up; not a blocker for build.
- **Sidecar storage for over-cap payloads (S3/MinIO).** HLD §D4 flags this as "would do next." This LLD does not implement it — Phase A treats truncated payloads as non-replayable per HLD §D4. No regression.
