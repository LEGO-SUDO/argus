# @argus/workers

NestJS worker context for Argus: the Redpanda **projection consumer** (Phase A)
plus the Phase B **live-events publisher**.

- `src/projection/projection.consumer.ts` — kafkajs consumer on `traces`
  (group `argus-projection`), decodes OTLP-JSON, hands each span to the service.
- `src/projection/projection.service.ts` — clear-fence gate → trace_events
  idempotency gate → inference write (incl. Phase B columns) → **post-commit**
  `live-events` publish.
- `src/projection/live-events-publisher.ts` — kafkajs producer for the
  `live-events` topic (key = `user_id`); publish-after-commit, errors swallowed.

## Quality gates

```bash
pnpm --filter @argus/workers typecheck
pnpm --filter @argus/workers lint
pnpm --filter @argus/workers test          # boots Postgres testcontainers
pnpm --filter @argus/db test               # migration 0003 schema-shape tests
pnpm --filter @argus/contracts test        # snake_case payload contract guard
```

## Phase B backend-infra smoke

End-to-end manual smoke for the Phase B control-plane ingestion path. Mirrors the
Phase A consumer smoke; adds the schema-migration check and the live-events
publish-after-commit ordering proof. Target timing budget: live tick visible in
**under 2s typical, under 5s** (the PRD's 5-second live-bar quality bar).

### 0. Schema-migration smoke (no compose needed)

Boots a throwaway Postgres, applies every committed migration, and asserts all
Phase B columns / tables exist. This is exactly what `@argus/db test` does:

```bash
pnpm --filter @argus/db test
# Asserts: inferences.kind (enum inference_kind, default chat) + index;
# inferences.{classifier_for_message_id,replay_of_inference_id,sample_workspace_id}
# FKs + indexes; inferences.updated_at ticks via Prisma; sample_workspaces &
# user_clear_fences tables; sessions.current_sample_workspace_id (SET NULL);
# trace_events.kind + (kind, created_at DESC) index; trace_events unique widened
# to (trace_id, span_id, name).
```

### 1. Bring the stack up

```bash
docker compose -f infra/compose/docker-compose.yml up -d --wait
```

### 2. (Task 39a) Confirm both topics exist; `live-events` has 3 partitions

```bash
docker compose -f infra/compose/docker-compose.yml exec redpanda rpk topic list
docker compose -f infra/compose/docker-compose.yml exec redpanda \
  rpk topic describe live-events | grep -i partitions
# Expect: traces + live-events present; live-events partitions = 3.
# Re-running `topics.sh` is idempotent (tolerates TOPIC_ALREADY_EXISTS).
# Override the name/shape with REDPANDA_LIVE_EVENTS_{TOPIC,PARTITIONS,REPLICAS}.
```

### 3. (Task 39b) Confirm the live-events publisher connected

```bash
docker compose -f infra/compose/docker-compose.yml logs workers --tail 200 \
  | grep -i "live-events publisher ready"
# Expect a line within ~5s of container ready.
```

### 4. (Task 39c) Prove publish happens AFTER the Postgres commit

Post one synthetic OTLP-JSON span carrying `llm.kind=chat` to the Collector's
OTLP/HTTP traces endpoint (`http://localhost:4318/v1/traces`,
`Content-Type: application/json`). Use a real `user.id` / `conversation.id` /
`message.id` (seed a placeholder inference via the api first, or accept the
`placeholder-missing` create path). Then:

```bash
# a) The DB row lands first:
docker compose -f infra/compose/docker-compose.yml exec postgres \
  psql -U argus -d argus -c \
  "SELECT id, kind, user_id FROM inferences ORDER BY started_at DESC LIMIT 1;"

# b) THEN one live-events record appears (observed AFTER the row), keyed by
#    user_id, value parseable as LiveEventsPayload {user_id, kind, conversation_id}:
docker compose -f infra/compose/docker-compose.yml exec redpanda \
  rpk topic consume live-events --num 1 --offset end
```

Assert: the Postgres row is observed first, the Kafka record within ~5s, its
`key` equals the span's `user.id`, and its value is snake_case. A duplicate
redelivery of the same span produces **no** second `live-events` record (the
`(trace_id, span_id, name)` unique gate filters it before publish).

### Notes

- `live-events` is produced by `apps/workers` directly (not via the Collector).
- A Kafka outage degrades to a missed tick (Sentry `recoverable=yes`) and never
  rolls back the committed DB write — the publish is awaited but self-swallows.
- Heartbeat spans must carry ≥1 span event so the `(trace_id, span_id, name)`
  dedup gate applies (the api heartbeat emitter owns this).
