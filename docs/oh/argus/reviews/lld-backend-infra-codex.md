## 0. Format Violations

Hard rejection: this LLD contains fenced blocks.

> ```  
> packages/db/  
>   prisma/  
>     schema.prisma  
> ...
> ```

Delete the fenced file-tree block or convert it to prose/bullets. The review criteria say code blocks in plans are a rejection criterion.

> ```  
> .env.example  
> ```

Same issue: fenced block continues through the file structure. Keep paths as bullets or inline text.

Several tasks include detailed test assertions that belong in test files, not the LLD.

> “asserts the returned object describes an `inferences` UPDATE keyed by `message_id` carrying tokens, latency, micro-USD costs, `trace_id`, `span_id`, plus a `trace_events` INSERT carrying the full input/output payloads under their respective keys.”

This is close to implementation-level assertion detail. Keep the behavior target, but leave exact assertion shape to the test.

> “asserts: the `inferences` row is updated in place with tokens, costs, latency, `trace_id`, `span_id`; one `trace_events` row exists; `messages.status` is NOT touched.”

This is acceptable as behavioral coverage, but the LLD repeats this pattern heavily. Reduce exact assertion lists where they become test-body instructions.

Task 3 is not RED/GREEN and lacks a non-TDD label.

> “### Task 3: [non-TDD — PrismaClient package export] Export PrismaClient singleton”

Actually the heading shown is:

> “### Task 3: [non-TDD — PrismaClient package export] Export PrismaClient singleton”

If this is present in the canonical file, fine. If not, add it. In the pasted LLD it is labelled correctly.

Tasks that are too large for the stated bite-size rule:

> “Task 18: Wire ProjectionConsumer to Redpanda”

This is not a 5-minute task. It includes Nest lifecycle wiring, Kafka consumer config, OTLP protobuf parsing, offset management, and manual smoke verification. Split into: consumer shell, OTLP decode, batch handling/commit semantics, and smoke.

> “Task 19: Workers bootstrap and `/healthz`”

This combines Nest bootstrap, health controller, Kafka readiness state, Prisma health query, package config, tsconfig, and Dockerfile. Split bootstrap/health from Docker packaging.

> “Task 24: Collector config: OTLP → Kafka + Jaeger fan-out”

This is risky and not bite-sized. Split Collector receiver/exporter config, compose service/healthcheck, and producer partition-key verification.

> “Task 25: Assemble all seven services with healthcheck-gated boot order”

This is too broad and depends on all prior infra. Keep as final smoke only, with no new implementation beyond wiring validation.

> “Task 27: One-turn ingestion smoke test”

It says “No new files” but also says it documents a README snippet. That is internally inconsistent and too large for one task. Add the README path and split documentation from actually running the smoke.

## 1. Tasks Too Vague To Execute

> “Redpanda topic bootstrap that pins `message_id` as the partition key”

Kafka topics do not pin a partition key. Later Task 22 corrects this by saying producer-side enforcement happens in Task 24. The scope section should be corrected to avoid misleading the builder.

> “producer.partition_key set to derive from the `message.id` resource attribute”

This is likely underspecified and possibly not supported as written by the OpenTelemetry Collector Kafka exporter. The builder needs the exact supported config field/version or an explicit fallback plan, because Collector Kafka partitioning options are version-sensitive.

> “parses each OTLP-encoded record (protobuf via `@opentelemetry/otlp-transformer`)”

The exact package/API is not specified, and the dependency is not listed in `apps/workers/package.json`. Builder needs the package name, supported import, and expected Redpanda message encoding.

> “shape from `packages/contracts`”

The current repo’s `packages/contracts/src/index.ts` is a placeholder. The LLD says to stop and wait if contracts do not exist, but the task list still proceeds as if they do. Add a preflight blocking task or make contracts an explicit dependency gate before Task 4.

> “use a test factory that wraps a transaction and rolls back”

No file path is given for the factory, and Prisma transaction rollback strategy is non-trivial in Jest. Specify whether to add a helper under `apps/workers/test/helpers/*` or keep setup inside the test file.

> “Dockerfile is a multi-stage pnpm build copying only the workspace slice this app needs.”

This is vague. With pnpm workspaces, Docker build context and lockfile/package copying are easy to get wrong. Give explicit constraints: root `pnpm-lock.yaml`, workspace file, root `package.json`, relevant app/package manifests.

## 2. Missing Acceptance Criteria

Task 27 has weak acceptance as a handoff artifact.

> “Files: No new files; uses compose + a transient shell command”

But:

> “This task documents the smoke procedure in a README snippet”

Acceptance should name the README path and require the snippet exists. Current file list and acceptance do not match.

Task 18 acceptance relies on manual smoke but not unit/integration behavior.

> “publishing one fabricated OTLP record ... causes a `trace_events` row to appear”

Add acceptance for offset commit behavior after success and no commit on failed DB write, otherwise the load-bearing at-least-once behavior is not observable.

Task 19 acceptance does not say what `/healthz` returns when Kafka or DB is down. Add negative acceptance, otherwise the endpoint may always return 200.

## 3. Test Gaps

The ownership boundary is tested only in Task 12.

> “`messages.status` is NOT touched”

Good, but add a static test/grep that fails if `projection.service.ts` references `message`/`messages` Prisma delegate. The current parenthetical says “or — simpler — a lint comment”, which is not enforceable.

No test covers malformed or missing required span attributes. The mapper and service need behavior for missing `message.id`, `user.id`, token counts, costs, or status. Without this, the consumer may poison-loop or write bad rows.

No test covers failed/error spans. The happy path uses `llm.status=ok`, but the schema has `InferenceStatus`; Phase A needs mapping for failed spans, `error_code`, and null/partial token fields.

No test covers payload cap integration with `span-mapper`. Task 10 tests `capSpanEventPayload` alone, but Task 4/5 expect full input/output payloads. Add a mapper/service test proving capped events produce `trace_events.replayable=false`.

No test covers Kafka offset behavior. Task 18 says manual commit after DB write, but there is no RED/GREEN or integration test for “handle throws means offset is not committed”.

No test covers transaction ordering/idempotency race. Task 15 says duplicate delivery should skip inference update if duplicate trace event exists. This implies the trace event insert/check must happen before mutation. Add a test where the second span has changed token values and verify it cannot restomp the inference.

No test covers failover with same provider but failed status, or different provider with non-failed existing row. Task 8 only covers three cases; builder may implement an underdefined branch.

## 4. File-Path Errors

The repo uses `typecheck`, not `type-check`.

Existing scripts:

> root `package.json`: `"typecheck": "turbo run typecheck"`  
> `apps/workers/package.json`: `"typecheck": "tsc --noEmit"`  
> `packages/db/package.json`: `"typecheck": "tsc --noEmit"`

LLD says:

> “type-check: `pnpm -r type-check`”  
> “`pnpm --filter @argus/db type-check`”  
> “`pnpm --filter @argus/workers type-check`”

These commands will fail. Use `pnpm -r typecheck` and `pnpm --filter @argus/db typecheck`.

Prisma commands are inconsistent with existing package scripts.

> “`pnpm --filter @argus/db prisma format`”

Use `pnpm --filter @argus/db exec prisma format` or add explicit scripts. Same for validate:

> “`pnpm --filter @argus/db exec prisma validate`”

This one is correct.

Task 27 says no new files while requiring README documentation.

> “Files: No new files”  
> “documents the smoke procedure in a README snippet”

Add `README.md` or `docs/oh/argus/...` to the file list.

Potential missing paths are expected to be created, but note that `infra/postgres/` does not currently exist. That is fine if the builder creates it.

## 5. Hand-Off Risk

The biggest risk is Collector Kafka partition-key config. The LLD assumes:

> “producer.partition_key set to derive from the `message.id` resource attribute”

This may not be a valid Collector config. If unsupported, the builder will either invent YAML or silently partition by trace ID/default key. The LLD needs a verified config example or an explicit processor/exporter alternative.

The idempotency design is internally awkward.

> “The guard interface is a check-then-record function that consults the database's unique index by attempting the `trace_events` insert”

Then ProjectionService also needs to insert `trace_events`. If the guard inserts, it must either receive the full trace event row or the service must not insert again. The LLD should define one owner for the insert. Current Tasks 7, 13, and 15 can lead to double-insert confusion.

Task 14 and Task 15 imply duplicate detection should happen before inference mutation.

> “if duplicate, also skip the `inferences` update”

Task 13 orders inference write before trace insert. Task 15 must explicitly reorder the transaction, otherwise duplicate delivery can update inference before detecting duplicate trace event.

Schema details are under-specified for Prisma.

> “Status enums (`message_status`, `inference_status`) are Prisma enums.”

Prisma enum names are usually `MessageStatus`, `InferenceStatus`; DB mapped enum names require `@@map`/`@map` or migration SQL expectations. Specify the Prisma enum values and DB naming/mapping.

The schema omits many required column decisions: IDs as UUID/string, timestamps defaults, nullable fields, cascade behavior, relation names, `created_at`/`started_at`/`completed_at`, latency column type/name, token/cost nullability. The builder will have to invent these.

Compose topology conflicts with existing skeleton responsibilities. Backend-infra LLD says finalize `web` and `api` services too, but those domains may be owned by other LLDs. Define whether backend-infra only preserves skeletons or is allowed to replace build/health behavior for `web` and `api`.

Use of `latest` images is risky.

> `redpandadata/redpanda:latest`  
> `jaegertracing/all-in-one:latest`  
> `otel/opentelemetry-collector-contrib:latest`

For reproducible infra, pin versions. Especially important for OTel Collector config compatibility.

Task 2 says:

> “do not apply it interactively here — apply will happen on `api` boot.”

But Task 12 integration test must run the migration. Define whether tests use `prisma migrate deploy`, raw SQL, or Prisma migrate APIs.

## 6. Quality Score

5/10.

The sequencing and ownership intent are strong, especially the “projection consumer never writes `messages.status`” boundary. But it is not ready to hand off: several tasks are too large, important config assumptions are unverified, commands do not match the repo scripts, and the idempotency insert ownership is ambiguous enough that a builder is likely to implement it incorrectly.
