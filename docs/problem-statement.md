# Problem Statement

Modern LLM applications fan out across multiple foundation-model providers, stream
responses token-by-token, fail over between providers, and rack up per-token cost —
yet most ship with almost no visibility into what actually happened on each call.
Once a response leaves the model, the metadata that matters for operating the system
(which provider answered, how long it took, how many tokens it burned, what it cost,
whether it errored or was canceled) is gone.

**Argus** is a lightweight chat application stitched to an inference logging and
ingestion pipeline that closes that gap: every model call made from the chat surface
is captured, shipped to an ingestion service in near real time, and surfaced in an
operator console for inspection, cost accounting, and replay.

## Scope

### 1. Chat application
A streaming, multi-turn chatbot over any foundation-model API (OpenAI, Anthropic,
Gemini, and a keyless mock provider for local development). It maintains
conversational context across turns and exposes a simple web UI with conversation
management — list, resume, and cancel conversations.

### 2. Capture SDK
A thin SDK/wrapper around the LLM calls that captures inference metadata without the
application code having to think about it:

- model and provider
- latency
- token usage (prompt / completion)
- timestamps
- request status and errors
- conversation / session id
- input / output previews
- per-call cost

The SDK emits this metadata to an ingestion endpoint in near real time
(roughly 5 seconds end-to-end).

### 3. Ingestion pipeline
A service that receives the captured telemetry, validates and parses the payloads,
extracts the useful metadata, and persists the processed records — built on an
event-based pipeline so capture and projection are decoupled and the write path stays
resilient.

### 4. Storage
Durable storage for chat messages, inference logs, and the extracted metadata, with a
schema designed around the read patterns the operator console needs (per-user,
time-windowed, grouped by provider / model / conversation).

### 5. Operator console
A console surface over the captured stream with three lenses on the same data:

- **Traces** — a live feed of inference events with latency, tokens, cost, status, and
  failover chains; filterable and searchable.
- **Cost** — aggregated spend in USD, grouped by conversation / provider / model.
- **Replay** — re-run a past inference against any available provider and compare the
  result side-by-side with the original.

## Capabilities

- **Multi-provider** routing with pre-first-token failover across configured providers.
- **Streaming responses** rendered token-by-token.
- **Latency, throughput, and error** observability in the console.
- **One-command setup** via Docker Compose.
- **Event-based architecture** for the capture → ingestion → projection path.

## Operating assumptions

- Single-tenant per user, single-replica deployment at modest volumes — the design
  favors simplicity and a correct live path over horizontal scale.
- The keyless mock provider keeps the full pipeline exercisable without any API keys;
  real-provider keys are supplied via environment configuration.
