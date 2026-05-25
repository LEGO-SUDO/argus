# Argus

**A streaming LLM chatbot with a built-in observability control plane.** Every
model call streams to the user in real time over WebSocket *and* lands in an
OpenTelemetry trace pipeline — so an operator can watch traces, attribute cost,
and replay any past inference against a different provider, all from a `/console`
that reads the same event spine the chat writes.

🔗 **Live demo:** **https://argus-web-tau.vercel.app/**
&nbsp;·&nbsp; sign in as **`demo@argus.dev`** / **`let-me-in-9`**

> The demo boots against the deterministic **mock provider**, so the full
> chat → trace → console pipeline runs end-to-end with zero LLM spend. Send a
> message in **Chat**, then open **Console** to see the trace, its cost, and
> replay it.

---

## What's inside

**Chat (`/chat`)** — multi-turn streaming chat over WebSocket, cancel/retry,
conversation list, per-conversation model picker, and an **Auto** mode that
classifies each message and routes it to the best provider.

**Console (`/console`)** — three operator lenses on the chat event spine:
- **Traces** — near-real-time inference feed with faceted filters, throughput, failover chains, and a span drawer.
- **Cost** — spend by provider / model / conversation, sparklines, unpriced-model flagging.
- **Replay** — re-run any past inference against a different provider/model and diff the result.

**Platform** — a synchronous **outbox** keeps chat state safe (a dropped span
never loses a user message) while telemetry is async-enriched into queryable
Postgres + Jaeger. Multi-provider router (OpenAI / Anthropic / Gemini / mock)
with a deterministic mock for keyless development, per-provider circuit
breaking, and failover. Live console updates ride the Redpanda spine over SSE
(no Redis). Errors flow to Sentry.

## Architecture at a glance

```
chat /chat ─► WS Gateway (NestJS) ─► Provider Router (SDK) ─► OTel spans
                   │                                              │
                   │ Prisma (sync, source of truth)               ▼
                   ▼                                        OTel Collector
              Postgres ◄── projection consumer ◄── Redpanda `traces` ──┤
              (chat + enriched inferences)    │                        └─► Jaeger
                   ▲                          └─► Redpanda `live-events` ─► SSE ─► /console
                   └──────────── console reads (Traces / Cost / Replay) ──────────┘
```

Full design — the outbox split, the schema's forward-compat locks, auto-routing,
replay, the clear-fence, and the live SSE/heartbeat liveness model — is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quick start

```bash
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

pnpm compose:up
```

First build takes ~3-5 min (Next.js standalone + NestJS images); subsequent
runs are cached. When you see `Nest application successfully started` from both
`api` and `workers` plus `Ready in Xs` from `web`:

- **Chat + Console** — http://localhost:3000 → log in as `demo@argus.dev` / `let-me-in-9`
- **Jaeger trace UI** — http://localhost:16686

### Real provider streaming (optional)

The default boot uses the deterministic mock provider so the stack is fully
exercisable with zero keys. To stream from a real LLM, set `MOCK_PROVIDER=false`
in `.env` and add at least one of:

```
OPENAI_API_KEY=sk-...        # tried first by default
ANTHROPIC_API_KEY=sk-ant-... # tried if OpenAI fails before first token
GOOGLE_API_KEY=...           # last in default order
```

The router fails over between configured providers if the chosen one errors
**before** the first token. Mid-stream errors propagate without stitching (so
the assistant message came from exactly one provider). Defaults are cheap+fast
(`gpt-4o-mini`, `claude-haiku-4-5`, `gemini-3-flash-preview`) — override via
`OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GOOGLE_MODEL`, reorder via
`PROVIDER_ORDER=anthropic,openai,gemini`. With an OpenAI key set, **Auto** mode
uses an LLM classifier (`coding → anthropic`, `research → gemini`,
`general → openai`); keyless, it falls back to a keyword heuristic.

## Workspaces

| Path | Purpose |
|---|---|
| `apps/web` | Next.js 15 — `/chat` streaming UI + `/console` (Traces/Cost/Replay) |
| `apps/api` | NestJS REST + WebSocket gateway — auth, conversations, chat orchestration, auto-router, replay, console, live SSE |
| `apps/workers` | NestJS standalone — Redpanda `traces` projection consumer + `live-events` publisher |
| `packages/sdk` | Multi-provider LLM SDK — router, circuit breaker, OTel instrumentation, context builder, deterministic mock |
| `packages/contracts` | Shared zod schemas — WS frames, REST DTOs, OTel attribute keys, live-events payload |
| `packages/db` | Prisma schema + migrations |
| `tests/e2e` | Playwright golden-path suite |

## Local development (hybrid mode)

Run infrastructure in Docker, apps locally with hot reload:

```bash
pnpm infra:up                          # postgres + redpanda + otel + jaeger only

# Update .env so app hostnames resolve from the host:
#   DATABASE_URL=postgresql://argus:argus@localhost:5432/argus?schema=public
#   REDPANDA_BROKERS=localhost:9092
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

pnpm dev:migrate                       # prisma migrate deploy (sources .env)
pnpm dev:api                           # → :4000
pnpm dev:workers                       # → :3002
pnpm dev:web                           # → :3000
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

## Deployment

Production runs **web → Vercel**, **api + workers + data plane → DigitalOcean
Kubernetes (DOKS)**, **Postgres → Neon**, with **Redpanda in-cluster**,
ingress-nginx + cert-manager (Let's Encrypt) fronting the API at
`https://api-argus.duckdns.org`. CI/CD (`.github/workflows/deploy.yml`) builds →
pushes to DOCR → migrates → rolls on every push to `main` touching `apps/api`,
`apps/workers`, `packages`, or `infra/k8s`.

The full end-to-end runbook — cluster creation, secrets, the PROXY-protocol and
cert-manager gotchas, and the Vercel proxy/WSS config — is in
[`infra/k8s/README.md`](infra/k8s/README.md).

## Configuration

All knobs live in `.env` (see [`.env.example`](.env.example)). Defaults boot a
fully-functional stack with the mock provider, so no API keys are required. To
enable real providers, set `MOCK_PROVIDER=false` and add at least one provider
key; the router fails over in priority order.

`SESSION_SECRET` is mandatory — the api refuses to boot without it. Generate
with `openssl rand -hex 32`. `SENTRY_DSN` is optional (error capture is a no-op
when unset).

## License

UNLICENSED.
