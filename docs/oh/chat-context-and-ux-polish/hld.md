---
phase: hld
status: APPROVED
slug: chat-context-and-ux-polish
created: 2026-05-24T16:31:40Z
updated: 2026-05-24T18:20:00Z
---

# HLD: Chat UX, Multi-Turn Context, and Provider Surface

## Architecture Decisions

### Decision 1: Replace `start`'s provider/model with a generic metadata frame driven by a router commit signal
**Choice:** `start` carries only message/conversation ids at `seq=0`. A generic `metadata` frame (open-shaped — populated with `provider` + `model` in this scope, room for token-count/latency/retry later without further contract churn) lands at `seq=1`; the first token shifts to `seq=2+`. **Load-bearing:** the orchestrator emits this frame only when the router fires a synthetic `committed` event raised the instant the chosen adapter yields its first non-empty token chunk — NOT from the gateway's pre-flight guess. Pre-token failure path is `start` → `error` → `end` (failed) with no metadata frame.
**Rationale:** Today the router surfaces the committed provider only on the terminal `done` chunk — too late, the chip would lie for the whole stream. A first-token commit signal makes the chip truthful; a generic envelope absorbs future post-start metadata.
**Alternatives:** Chunk-envelope `providerMeta` (couples wire + routing, every adapter must remember to set it); provider-specific frame (closes door on future metadata).
**One-way door?** Yes — frame addition, `seq` invariant change, every WS consumer's exhaustive switch.

### Decision 2: Pin lives on `conversations`; PATCH validates against the live catalog
**Choice:** Two nullable columns on `conversations` (null = Auto). PATCH validates the pin combination against the same source-of-truth catalog the picker reads; invalid combos reject 4xx and never persist. Gateway reads the pin per send to bypass failover.
**Rationale:** Persistence is required (cross-device restore). The conversation row is the natural owner. PATCH-time validation prevents storing a pin that can never succeed.
**Alternatives:** Per-message override only (no persistence); separate settings table (premature normalization).
**One-way door?** Yes — additive migration; **Prisma `@map` to snake_case columns is chosen NOW**; renaming later breaks SQL projections.

### Decision 3: SDK accepts a per-request override; router has a separate branch that never falls back
**Choice:** `ChatStreamRequest` gains an optional override carrying provider+model. The router's override branch is a fully separate code path (not a flag inside the failover loop): look up the exact adapter, stream, or throw a distinct wire-visible error code. Today's failover is byte-identical when override is absent.
**Rationale:** Single public entry point keeps the contract narrow; separating the branch prevents accidental fallback leaks.
**Alternatives:** Routing-mode enum (same shape, cosmetically nicer); per-request env (untestable).
**One-way door?** No — additive optional field.

### Decision 4: One model catalog — extend the existing pricebook with a context-window field
**Choice:** The existing SDK pricebook grows a per-entry context-window field (rename to `model-catalog.ts` is fine). One accessor returns both cost and window. Effective budget = min(configured default, pinned model's window).
**Rationale:** Two parallel tables keyed by the same composite key invite drift. One catalog, one cap, one source of truth.
**Alternatives:** Parallel `context-windows.ts` (drift); per-adapter getter (forces adapters to track values they don't natively expose).
**One-way door?** No — pure data.

### Decision 5: Context fields ride the terminal `end` frame for completed turns; no post-`end` frame
**Choice:** For `status=complete`, `end` carries tokens-used and tokens-budget. For failed/canceled the fields are absent (PRD: only completed turns count). The REST messages-list response carries the same fields so a resumed conversation paints the meter on first render.
**Rationale:** Removes post-terminal frame-ordering risk and the `seq > end` invariant violation in one stroke.
**Alternatives:** Separate post-`end` `context` frame (ordering hazard); REST poll per turn (race-prone).
**One-way door?** Yes — both wire and REST shapes change in lockstep with Decision 1; **the REST messages-list response shape is a client contract**.

### Decision 6: API owns the provider-list surface; the SDK helper backing it stays internal
**Choice:** A new minimal API endpoint returns configured providers + models + cost + context-window for the picker. The SDK exposes an internal helper the API consumes; nothing new is added to the SDK's public surface. The picker calls only the API. Mock provider listing is gated by env.
**Rationale:** Public SDK exports are a semver-major commitment. Single runtime source means picker options match gateway behavior because they read the same catalog through the same call.
**Alternatives:** Public SDK export (one-way door, no payoff); env-driven catalog (operator burden).
**One-way door?** No — internal-only helper.

### Decision 7: Markdown via react-markdown + remark-gfm + rehype-sanitize; user input stays plain text
**Choice:** Assistant content renders through react-markdown with GFM + sanitize. Allowed URL schemes: http, https, mailto, protocol-relative (same-origin), relative paths, hash links. Stripped: `javascript:`, `data:`, `vbscript:`. External links get noopener attrs. Partial Markdown renders as-is (streaming-safe).
**Rationale:** React ecosystem default + standard sanitize gate. No syntax highlighting (non-goal).
**One-way door?** Yes — user-perception contract; rollback post-launch is costly even if technically reversible.

## Component Map

**Backend (`apps/api`).** Gateway remains the only frame emitter. New `ContextMeterService` turns a conversation into a tokens-used/tokens-budget pair via the shared 4-chars-per-token heuristic, capped by catalog lookup, resilient to catalog miss. Orchestrator subscribes to the router's commit signal and emits the metadata frame; embeds context fields on terminal `end` for completed turns. `ChatService.startTurn` order-of-operations is load-bearing: **persist the new user message FIRST**, then assemble history from the messages table (excluding any prior `status=streaming` assistant row by status filter), then thread the pin into the SDK request — guarantees the latest user message appears exactly once. New minimal `ProvidersController` exposes the picker catalog. `ConversationsController` PATCH accepts pin fields with live-catalog validation.

**SDK (`packages/sdk`).** One catalog answers both cost and context-window queries. Router's override branch is separate from failover; surfaces a distinct error code on adapter failure. New internal helper joins configured adapters with the catalog. Router fires a synthetic commit event on the chosen adapter's first non-empty token. Fallback resolver downgrades "previously-pinned model no longer configured" to Auto with a one-time inline notice.

**Web (`apps/web`).** `MessageContent` renders Markdown for assistant rows, plain text for user. Composer's static pill becomes `ProviderPicker` sourced from the API, Auto-default, disabled during streaming. Reducer handles the metadata frame (write once, idempotent on replay) and the expanded `end` (hydrates meter). `ContextMeter` renders the tokens-used-over-budget fraction. `useFocusComposer` re-focuses on mount, after composer-lock release, and on conversation-id change.

## Test-Driven Development

### TDD-able surfaces
- **Router override branch** — success / adapter-fails / adapter-not-configured; no fallback leaks.
- **Router commit signal** — fires once on first non-empty token; never on empty/meta chunks or pre-token error.
- **Model catalog accessor** — known returns both fields; unknown returns documented defaults; effective-budget min-computation.
- **Fallback resolver** — previously-pinned-unavailable downgrades to Auto and signals notice.
- **`ChatService.startTurn` history assembly** — never-drop-latest-user-message invariant; in-flight streaming row excluded; pin-aware; truncation-on-overflow.
- **Message-stream reducer** — metadata-frame action (idempotent on replay); expanded `end` (hydrates for complete, skips for failed/canceled); `start` no longer touches chip.
- **`ProviderPicker` empty-state + disabled-while-streaming** — pure hook/reducer (visual is the only non-TDD slice).
- **Markdown sanitization** — disallowed schemes stripped; external links get noopener; same-origin doesn't.
- **`ContextMeterService`** — sums via heuristic, applies pin-aware cap, tolerates missing catalog entry.
- **Providers controller payload** — only configured providers; mock-gating respected.
- **Contracts Zod schemas** — new frame parses; discriminated union still rejects unknowns.
- **PATCH pin validation** — accept valid combos; reject invalid; clear-to-null path.

### Non-TDD-able surfaces
- **Picker dropdown visual** — Playwright open-pick-send-verify-chip.
- **Markdown rendering fidelity** — Playwright screenshot diff against seeded fixture.
- **Composer focus persistence** — Playwright keyboard-only across send/load/URL-swap.
- **Multi-turn "what's my name?"** — Playwright against one real provider, env-gated.
- **OTel attribute presence** — existing collector smoke test via Jaeger search.

## Regression Risk Surface

- Gateway/orchestrator/frame-builder tests asserting `start` carries provider+model break; cases move to the metadata frame.
- Pre-orchestrator failure paths (conv create fail, ownership reject) must NOT emit the metadata frame — chip must stay at ellipsis-then-failure.
- SDK failover must be byte-identical when override is unset — separate code path, not a flag inside the loop.
- `MessageList` switching to Markdown changes line-break behavior in existing fixtures and Playwright snapshots — update same PR.
- `useConversationHistory` must hydrate the new context fields; reducer accepts them on init.
- Contracts discriminated union expands; every exhaustive switch (reducer, gateway tests, frame-builder) needs new cases.

## File-Change Inventory

- `packages/contracts/src/ws.ts` — drop provider/model from `start`; add generic metadata frame; expand `end` with context fields for complete turns; document `seq` invariant.
- `packages/contracts/src/index.ts` — re-exports.
- `packages/contracts/src/__tests__/` — schema tests for new/changed frames.
- `packages/sdk/src/index.ts` — request-type override field; internal catalog helper export.
- `packages/sdk/src/router.ts` — override branch + commit-signal emission + new error code.
- `packages/sdk/src/cost.ts` (or `model-catalog.ts`) — add context-window field per entry; combined accessor.
- `packages/sdk/src/providers/list.ts` — NEW. Joins configured adapters with catalog.
- `packages/sdk/src/otel.ts` — new span attrs (see Observability).
- `packages/sdk/src/__tests__/router.test.ts` — override branch + commit signal.
- `packages/sdk/src/__tests__/otel.test.ts` — new attr presence.
- `packages/db/prisma/schema.prisma` + `migrations/<next>_conversation_pin/` — add pin columns with `@map` to snake_case.
- `packages/db/prisma/seed.ts` — confirmed no change (pin columns nullable).
- `apps/api/src/chat/chat.gateway.ts` — read pin; pass override; subscribe to commit signal; emit metadata frame; embed context on `end`.
- `apps/api/src/chat/stream-orchestrator.ts` — wire commit-signal handler; carry pin info for span attrs.
- `apps/api/src/chat/frame-builder.ts` — builders for the new metadata frame and expanded `end`.
- `apps/api/src/chat/context-meter.service.ts` — NEW.
- `apps/api/src/chat/chat.service.ts` — `startTurn` user-first persistence + history assembly + pin threading.
- `apps/api/src/chat/__tests__/stream-orchestrator.test.ts` — updated frame assertions.
- `apps/api/src/conversations/conversations.controller.ts` + `conversations.repository.ts` — PATCH pin fields with live-catalog validation; messages-list response carries context; fallback-to-Auto on read.
- `apps/api/src/conversations/__tests__/` — PATCH expansion + validation cases.
- `apps/api/src/providers/providers.controller.ts` + `providers.module.ts` — NEW. Picker catalog endpoint.
- `apps/web/lib/sanitize-markdown.ts`, `use-focus-composer.ts`, `providers-api.ts` — NEW helpers/hook/client.
- `apps/web/components/chat/MessageContent.tsx`, `ProviderPicker.tsx`, `ContextMeter.tsx` — NEW.
- `apps/web/components/chat/MessageList.tsx`, `MessageStream.tsx`, `MessageComposer.tsx` — wire new components, frame types, focus hook.
- `apps/web/lib/message-stream-reducer.ts` + `use-conversation-history.ts` — new cases + hydration.
- `apps/web/lib/__tests__/message-stream-reducer.test.ts` + `use-conversation-history.test.ts` — new cases.
- `apps/web/package.json` — add react-markdown, remark-gfm, rehype-sanitize.

## Observability

OTel + Jaeger only.

- Effective context budget AND the model's catalog cap on the chat span — both, so "why was budget X not Y?" is trace-answerable.
- Pinned-failure detection — boolean + error code on the span; operators search the exact set.
- Guess-vs-commit divergence attr — flips when the gateway's pre-flight choice differs from the router's commit; answers "did the chip lie?" historically.
- Structured event when history is truncated to fit budget (captures "model claims no memory of turn N").
- Structured event when a persisted pin falls back to Auto.
- If meter computation throws, the `end` frame still ships (tokens field null) and the error is logged separately — observability never breaks the user-visible terminal frame.

## Sequencing

One coordinated PR for the three exhaustive-switch consumers: contracts frame additions + API orchestrator/frame-builder + web reducer. Prevents intermediate build breakage on the discriminated union. Independent follow-ups: `ProviderPicker` UI, `ContextMeter` UI, Markdown rendering, observability attrs. The Prisma migration ships with the gateway PR. Expect lockfile churn and turbo cache invalidation in SDK + contracts.

## Confirmed Defaults

Pin → Auto switch takes the click (no modal). Empty-state composer copy: env-var names only, no docs link. Pin clear effective next turn; picker disabled during streaming.

## Open Questions

None blocking LLD. Remaining design space (exact attribute names, endpoint paths, error-code strings, sanitize-config shape) is LLD-owned per HLD discipline.
