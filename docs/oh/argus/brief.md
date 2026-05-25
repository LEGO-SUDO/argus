---
phase: brief
status: APPROVED
slug: argus
created: 2026-05-23T15:01:50Z
updated: 2026-05-23T15:01:50Z
---

# Brief: Argus — Inference Logging & Ingestion

## Problem Statement

Argus provides a lightweight inference logging and ingestion system for an LLM application. Required deliverables: a chatbot, an SDK that captures inference metadata, an ingestion pipeline, database storage, README + architecture notes, and a demo. The spec offers a **stretch bonus tier** for completing the listed bonus features.

Full problem statement: `docs/oh/problem-statement.md`.

## Target User

**Primary:** The operator running Argus. They evaluate velocity, pragmatism, product intuition, and observability and scaling literacy (the spec names "observability stack" and "near real-time inference").

**Secondary:** The team running it in production — this artifact functions as a credibility anchor and as a template to reach for at the first high-volume customer.

## Status Quo

Operators compare multiple builds. Common patterns:
- **Most builds:** must-haves + 2-3 bonuses
- **Few:** full stretch bonus tier
- **Almost none:** full bonus tier *plus* a unifying architectural narrative *plus* senior-level code quality

The "exceptional" bar is not more features — it is *coherence*. A senior-level build is recognizable not by line count but by the spine running through the pieces. Two independent cold-readers (Codex + Claude-fallback) flagged scope inflation as the #1 failure mode for this kind of build; the scope below has been narrowed in response.

## Narrowest Wedge

A single repo, one `docker compose up`, that delivers in this build order:

**Phase A — Chatbot foundation (must work end-to-end before Phase B starts):**
- All four must-haves: chatbot · SDK · ingestion · storage
- Multi-provider (OpenAI + Anthropic + Gemini) with failover
- Mock provider for keyless demo runs
- Streaming responses over WebSocket
- Cancel a conversation · list conversations · resume a conversation (= new message in existing conversation; mid-stream resume deferred but message_id contract is forward-compatible)
- Short conversational context (last N turns, hard-capped at ~6k tokens, configurable via env)

**Phase B — Control plane (the differentiator; layered on top of Phase A):**
- Three-lens `/console` over a single OTel-native event spine: **Traces · Cost · Replay**
- All on shared event data — one inference, enriched once, drives all three tabs

**Why this scope and not larger:** Evals was dropped on both cold-readers' advice. Replay is the load-bearing demo (cross-provider re-run with cost + latency + output diff — the screenshot an operator sends to their cofounder).

**Why this scope and not smaller:** Cost is cheap relative to its founder-pleasing impact (DB rollups + Recharts panel). Replay is the differentiator. Traces is the Observability-vocabulary hit. Dropping any of the three weakens the "senior-level spine" frame more than it saves time.

## Constraints

- **Stack (locked):** Turborepo + pnpm · Next.js (App Router) frontend · NestJS backend · Postgres · Docker Compose
- **Streaming transport:** WebSocket via `@nestjs/websockets`. Streaming logic lives in the NestJS layer alongside the LLM call. Server assigns a stable `message_id` *before* the first token streams and includes it in every WS frame envelope — forward-compatible with future mid-stream resume.
- **Ingestion architecture (single path):** SDK → OTLP/HTTP → OTel Collector → Redpanda `traces` topic → NestJS projection consumer → Postgres. Jaeger consumes the same topic for free trace-detail UI linked from the Traces tab. BullMQ workers (cost rollup, replay engine) read from Postgres.
- **Provider mix:** 3 SDK adapters — OpenAI, Anthropic, Gemini. Chosen to cover the three big SDK ecosystems and enable a real failover demo.
- **Provider keys:** env vars only; ship `.env.example`; the operator provisions their own keys.
- **No-keys fallback:** `MOCK_PROVIDER=true` in the default `.env` makes the SDK return deterministic streamed tokens from a tiny stub. The operator can run `docker compose up` with zero external dependencies and see the entire stack — chat, streaming, ingestion, all three tabs — populate end-to-end. README documents the one-line swap to real providers.
- **Conversational context:** last N turns hard-capped at ~6k tokens (configurable via env, default 6000), drop oldest first, no summarization.
- **Resume semantics:** new message in existing conversation (load history + send new turn). True mid-stream reconnect deferred — `message_id`-in-envelope contract preserves the option without protocol break.
- **App shape:** one Next.js app, route-split (`/chat` consumer + `/console` control plane). Documented in the README as a deliberate demo-vs-prod tradeoff (*"in production these are two apps with different auth domains; collapsed for the demo to keep one repo, one compose, one URL"*).
- **Time:** unbounded — polish over speed.
- **Team:** solo.
- **Deferred (explicit non-goals for this build, each documented in README as "would do next, here's how"):**
  - Hosted demo / k8s deploy
  - PII redaction
  - Evals tab (with one-paragraph design sketch: golden dataset shape, judge model, schedule, drift chart wireframe)
  - True mid-stream resume (with one-paragraph design sketch: server-side stream buffer, sequence numbers, replay-on-reconnect)

## Success Criteria (observable)

1. Every must-have deliverable demos in under 60 seconds.
2. Every in-scope stretch bonus is present and exercised in the demo path (multi-provider · streaming · dashboards · Docker Compose · event-based architecture · cancel/list/resume).
3. `docker compose up` on a clean machine with the shipped `.env` boots the entire stack — *including the chat working end-to-end via the mock provider* — within ~60s.
4. End-to-end latency: a user message flows chat → SDK → OTel Collector → Redpanda → projection consumer → all three control-plane tabs within ~5 seconds.
5. The README architecture section reads like a senior-level engineer wrote it — passes the *"would I send this to a friend who interviews at Stripe"* sniff test.
6. Observability-vocabulary check: the words *"observability stack"*, *"near real-time"*, *"event-based architecture"*, *"high-velocity"*, *"high-volume"* all have a concrete answer in the app.
7. The differentiator (three-lens control plane on a single OTel spine) is the first thing the operator's eye catches when they `cd` into the repo and open the README. Replay demo is the screenshot the operator wants to send to their cofounder.

## Recommended Approach

```
chatbot (/chat) ──► WS Gateway (NestJS) ──► Provider Router (SDK)
                                                  │
                                                  │  OTel-instrumented (span per call)
                                                  ▼
                                         OTLP/HTTP ──► OTel Collector
                                                           │
                                                           ▼
                                                  Redpanda `traces` topic
                                                           │
                                ┌──────────────────────────┼──────────────────────────┐
                                ▼                          ▼                          ▼
                       NestJS projection            Jaeger UI                 BullMQ workers
                       consumer                  (free trace-detail UI)     (cost rollup, replay)
                                │                                                     │
                                └─────────►   Postgres   ◄────────────────────────────┘
                                                  ▲
                                                  │
                                          /console UI (3 tabs)
                                          Traces · Cost · Replay
```

**Apps:**
- `apps/web` — Next.js, route-split (`/chat` consumer + `/console` control plane)
- `apps/api` — NestJS: REST + WS Gateway
- `apps/workers` — NestJS: Redpanda projection consumer + BullMQ workers (cost rollup, replay engine)

**Packages:**
- `packages/sdk` — OTel-instrumented LLM wrapper; multi-provider adapters (OpenAI, Anthropic, Gemini, Mock); retry + failover + circuit breaker
- `packages/db` — Prisma schema + migrations
- `packages/contracts` — shared TS/zod types for OTel attribute schemas, WS frame envelopes (including `message_id`), and Postgres projection shapes. **Authored before the WS Gateway is written** — cold-reader insight: defining capture contract first prevents retrofit surgery later.

**Infra (compose):** postgres · redis (BullMQ) · redpanda · otel-collector · jaeger

## Open Questions (deferred — do not silently fill in)

- **Phase 2 (PRD) deliverable — explicitly promoted:** Full data model and event contract. Postgres schema (conversations, messages, inferences, provider attempts, token usage, cost, errors, replay runs). OTel attribute schema. Trace-event-vs-projection boundary. Idempotency keys. Late-arriving-span reconciliation. *Both cold-readers flagged this as the underspec that, if vague, makes the coherence claim collapse.*
- **Phase 3a (HLD) decisions:**
  - Dashboards inside `/console` tabs only, or Grafana panels embedded as well?
  - Replay UI layout: side-by-side diff vs. tabbed comparison vs. inline?
  - Cost rollup cadence: per-event live update vs. batched cron?
- **Phase 4 final decisions:**
  - Hosted demo URL vs. compose-only + Loom video?
  - Repo name on GitHub when published?
