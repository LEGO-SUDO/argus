# Argus

LLM chatbot with inference observability. Every model call streams to the user
in real time over WebSocket *and* lands in an OpenTelemetry trace pipeline —
chat state via a synchronous outbox so a dropped span never loses the user's
message, telemetry async-enriched into queryable Postgres + Jaeger.

Multi-provider router (OpenAI / Anthropic / Gemini / mock) with deterministic
mock for keyless development.

## Quick start

```bash
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

pnpm compose:up
```

First build takes ~3-5 min (Next.js standalone + NestJS images). Subsequent
runs are cached. When you see `Nest application successfully started` from
both `api` and `workers` plus `Ready in Xs` from `web`:

- **Chat UI** — http://localhost:3000 → log in as `demo@argus.dev` / `let-me-in-9`
- **Jaeger trace UI** — http://localhost:16686

### Real provider streaming (optional)

The default boot uses the deterministic mock provider so the stack is
end-to-end exercisable with zero keys. To stream from a real LLM, set
`MOCK_PROVIDER=false` in `.env` and add at least one of:

```
OPENAI_API_KEY=sk-...        # tried first by default
ANTHROPIC_API_KEY=sk-ant-... # tried if OpenAI fails before first token
GOOGLE_API_KEY=...           # last in default order
```

The router fails over between configured providers if the chosen one
errors **before** the first token. Mid-stream errors propagate to the
client without stitching (so the assistant message you see came from
exactly one provider). Default models are cheap+fast (`gpt-4o-mini`,
`claude-haiku-4-5`, `gemini-3-flash-preview`) — override via
`OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GOOGLE_MODEL`. Reorder priority via
`PROVIDER_ORDER=anthropic,openai,gemini`.

## Workspaces

| Path | Purpose |
|---|---|
| `apps/web` | Next.js 15 chat surface — auth, conversation list, streaming UI |
| `apps/api` | NestJS REST + WebSocket gateway — auth, conversations CRUD, chat orchestration |
| `apps/workers` | NestJS standalone context — Redpanda projection consumer |
| `packages/sdk` | Multi-provider LLM SDK with OTel instrumentation + deterministic mock |
| `packages/contracts` | Shared zod schemas: WS frames, REST DTOs, OTel attribute keys |
| `packages/db` | Prisma schema + migrations |
| `tests/e2e` | Playwright golden-path suite |

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design — the
outbox pattern that separates chat state from telemetry, the OTel ingestion
spine, the schema's forward-compatibility decisions, and the test-driven
partitioning of TDD-able vs smoke-tested surfaces.

## Local development (hybrid mode)

Run infrastructure in Docker, apps locally with hot reload:

```bash
pnpm infra:up                          # postgres + redpanda + otel + jaeger only

# Update .env so app hostnames resolve from the host:
#   DATABASE_URL=postgresql://argus:argus@localhost:5432/argus?schema=public
#   REDPANDA_BROKERS=localhost:9092
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

set -a; source .env; set +a
pnpm --filter @argus/db exec prisma migrate deploy
pnpm --filter @argus/api dev          # → :4000
pnpm --filter @argus/workers dev      # → :3002
pnpm --filter @argus/web dev          # → :3000
```

## Testing

```bash
pnpm test                              # unit + integration (all workspaces)
pnpm typecheck                         # all workspaces
pnpm build                             # all workspaces

# End-to-end (requires the docker stack running):
pnpm compose:up -d
pnpm --filter @argus/e2e exec playwright install chromium
pnpm e2e
```

## Configuration

All knobs are in `.env`. The defaults boot a fully-functional stack with the
mock provider so no API keys are required. To enable real providers, set
`MOCK_PROVIDER=false` and add at least one of `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`. The router fails over in priority order.

`SESSION_SECRET` is mandatory — the api refuses to boot without it. Generate
with `openssl rand -hex 32`.

## License

UNLICENSED.
