---
phase: lld
status: APPROVED
slug: argus
scope: phase-b
workstream: frontend-web
builder: frontend-web-worker
reviewer: oh-cross-model --model codex
tester: oh-cross-model --model codex
revision: 3
created: 2026-05-25
updated: 2026-05-25
---

# LLD: frontend-web — Argus Phase B (Control Plane)

Phase B web surface only. This LLD covers the `/console` shell (Traces / Cost / Replay tabs), the shared `LiveBadge` / `ClearModal` / `SampleDataButton` / `EmptyState` controls, and the new transport layer — typed SSE client, console REST API client, and the `useLiveBadge` hook. Phase A surfaces (`/login`, `/signup`, `/chat`, `/chat/[conversationId]`, the WS streaming reducer) and PR #4's real-provider streaming are already merged and not modified in this LLD. The `/chat` surface enhancements (provider selector, keyless-Auto banner, WS `send` frame extension, persisted selection) are **out of scope for this LLD** — they will be picked up by the parallel `docs/oh/chat-context-and-ux-polish/` bundle once that planning track lands. See "Deferred to chat-context-and-ux-polish bundle" at the bottom of this file.

## Builder
**agent:** frontend-web-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the actual tests via the wrapper

## Scaffold facts (verified against argus `main`)

- **Phase A + PR #4 scaffold:** React 19, Next.js 15.5.18 App Router, TypeScript 5.6, pnpm workspaces / Node 20, Tailwind 3.4. Jest 29.7 + ts-jest 29.2 + `@testing-library/react` 16.1 + `@testing-library/jest-dom` 6.6 + `@testing-library/user-event` 14.5 + jest-environment-jsdom are all pre-installed and configured under `apps/web/`. `jest.config.js`, `jest.setup.ts`, `__mocks__/server-only.js`, and `__mocks__/style-mock.js` exist. **No Jest/RTL setup task is needed in this LLD.**
- **Phase A Library files that this LLD reuses (all present at the listed paths):**
  - `apps/web/lib/ws-client.ts` — reference shape for the new SSE client.
  - `apps/web/lib/server-session.ts` — auth gate for `/console` server pages.
  - `apps/web/lib/server-api-fetch.ts` — server-side typed fetch used by `console-api.ts` server helpers.
  - `apps/web/lib/auth-fetch.ts` — client-side typed fetch used by `console-api.ts` browser helpers.
  - `apps/web/lib/conversations-api.ts` — pattern example for a typed REST helper module.
- Path aliases unchanged: `@/*` → `apps/web/*`, `@argus/contracts` → `packages/contracts/src/index.ts`, `@argus/contracts/*` → `packages/contracts/src/*`. Phase B frontend code consumes shared types as **`@argus/contracts/...`** (workspace dependency already declared in `apps/web/package.json`).
- Per-workspace test script: `pnpm --filter @argus/web test`. Per-file pattern: `pnpm --filter @argus/web test -- <pathOrPattern>`.
- Next 15 async-API surface still applies: `cookies()`, `headers()`, route `params`/`searchParams` are `Promise<...>`. Phase B's `/console` pages must `await` per the Phase A pattern.
- `packages/contracts/src/` currently exports `auth`, `conversations`, `errors`, `otel-attrs`, `projection`, `ws`. There is no `__tests__` directory yet — Task 1A creates it. Jest + ts-jest are pre-installed in `packages/contracts/package.json` but no config file exists; Task 1A creates `packages/contracts/jest.config.js` mirroring the `apps/web` shape (node env, no jsdom).
- The current `apps/web/app/` tree has `(auth)/`, `chat/`, `layout.tsx`, `page.tsx`, `globals.css`. No `console/` subtree exists yet — this LLD creates it.
- **New dependencies this Phase B LLD adds:** none. The diff payload is server-computed (HLD D4) so no `diff`/`jsdiff` client dep is needed. SSE uses the browser-native `EventSource` so no polyfill. If the worker discovers a real need to add a dep mid-build, they raise it to the lead — no silent additions.

## Coordinated contract exports

`packages/contracts/src/` must expose the following named exports before this LLD's SSE-client and console-api tasks land. Both this LLD and the backend-api Phase B LLD assume these names — they MUST agree. Backend-api owns most of the schema authoring; this LLD's Tasks 1A-1B verify the **client-consumable** shapes round-trip cleanly for the frontend.

- `packages/contracts/src/live-events.ts`
  - `LiveEventSchema` (zod) — discriminated union on `type`. The `tick` variant carries `{ user_id, kind, conversation_id }`. The `heartbeat` variant the live-badge derives from.
  - `LiveEventKindEnum` — string-literal union of allowed `kind` values: `'chat' | 'classifier' | 'replay' | 'sample' | 'heartbeat' | 'unknown'` (matches the HLD's `kind` enum on `inferences`).
  - `LiveEvent` (TS type inferred).
- `packages/contracts/src/console.ts`
  - `TraceRowSchema`, `TraceListResponseSchema` (includes `rows`, `throughput`, `next_cursor`; field-level shape authored in backend-api LLD).
  - `CostGroupSchema`, `CostResponseSchema` (includes `groups`, `total_micro_usd`, `sparkline`, `unpriced_models`).
  - `ReplayCandidateSchema`, `ReplayDetailSchema`, `ReplayRunRequestSchema`, `ReplayRunResponseSchema` (the response carries the new inference row id + the precomputed diff payload).
  - `SampleGenerateResponseSchema`.
  - `ClearPreviewResponseSchema`, `ClearExecuteRequestSchema` (the execute request carries the literal `'CLEAR'` confirmation).
  - `ProviderSelectionSchema` — string-literal union over the supported providers plus `'auto'` and `'mock'`. **Owned and consumed by the chat-context-and-ux-polish bundle** — listed here only because the `console-api.fetchProviderAvailability` helper consumes the same provider enum for replay's `ProviderModelPicker`.
  - `TimeWindowSchema` — string-literal union `'24h' | '7d' | 'all'`.
  - `ProviderAvailabilityResponseSchema` — for `GET /api/providers/availability`. Per-provider model list is shipped server-side from the `packages/sdk` pricing snapshot — the snapshot is the single source of truth for which models each provider exposes. The frontend never hardcodes a model catalog.
  - `BadgeLagResponseSchema` — for `GET /api/console/live/badge`.
  - All companion TS types inferred from schemas.
- `packages/contracts/src/index.ts` re-exports all of the above.

If a frontend task starts before the contract task has landed, the frontend worker pauses that task and surfaces the dependency to the lead — no contract stubs are invented in `apps/web/`. (See Tasks 1A-1B for the cross-LLD round-trip verification this LLD owns.)

## SSE client model

`sse-client.ts` mirrors `ws-client.ts` in shape so reviewers see one transport idiom across the app. The client wraps the browser `EventSource`, validates every inbound `message` event payload against `LiveEventSchema`, and exposes handler registration for connection-open, parsed-event, and error events plus a `close()` method. The client accepts a URL and a credentials flag at construction. Default URL via `defaultSseUrl()` helper that reads `NEXT_PUBLIC_SSE_URL` (default `/api/console/live` — same-origin so the session cookie attaches; cross-origin SSE auth is out of scope for Phase B and flagged in Open Questions).

**Reconnect.** The browser `EventSource` reconnects automatically on transport drop. The wrapper does not duplicate this — it forwards `error` events to the error handler with a `reason: 'transport'` and a `readyState` field so the caller can render the badge state. The wrapper does NOT implement application-level reconnect; that lives in the `useLiveBadge` hook, which decides when to surface "ingestion failure (retry)" based on heartbeat freshness.

**Last-Event-ID.** Per HLD D3, the SSE tick is a notification ("something changed for this user, refetch your slice") — clients do not reconstruct state from the event stream. Last-Event-ID is therefore NOT used to replay missed events; reconnect just resumes notifications and any rows missed during the gap are surfaced by the next user-triggered refetch or the next live tick. Documented as such in `sse-client.ts` so future maintainers don't add replay logic.

**Dedupe.** The hook layer (see `useLiveBadge` and the tab-level refetch hooks) is responsible for debouncing event-driven refetches under burst (per HLD Regression Risk Surface — Generate-Samples must not trigger a refetch storm). The SSE client is a thin event pipe; the hook is where business logic lives.

## LiveBadge state model (derived, pure)

`LiveBadge` and `useLiveBadge` together implement the three-state machine from PRD §Live update behavior:

- **`live`** (green) — most recent heartbeat or persisted inference is within the green threshold (5s default).
- **`behind`** (amber) — lag is between green threshold and error threshold (5s ≤ lag < 30s); badge shows the integer-rounded second count.
- **`error`** (red) — no heartbeat for ≥ error threshold (30s default), or the live-badge query itself returned an error (e.g. DB unreachable, network).

State derivation is a **pure function** of `{ lagMs, queryError, thresholds }`. Implemented in `derive-live-badge-state.ts` so it can be unit-tested without React. `useLiveBadge` is a thin React wrapper that polls `/api/console/live/badge` on a fixed cadence and runs the pure derivation each tick.

## Jaeger link format

`<TraceRow />` exposes a per-row Jaeger deep link. Format: `${JAEGER_BASE_URL}/trace/${trace_id}` where `JAEGER_BASE_URL` is read from `process.env.NEXT_PUBLIC_JAEGER_URL`, defaulting to `http://localhost:16686` (Jaeger Query UI default port for the compose stack). The link opens in a new tab.

## File Structure

Each file has one clear responsibility. The `/console` surface is colocated under `apps/web/app/console/`; shared console controls live under `apps/web/components/console/`; transport and hooks live under `apps/web/lib/`. **No files under `apps/web/components/chat/` are created or modified by this LLD** — chat surface enhancements are deferred (see bottom).

### Routes / pages (Next.js App Router under `apps/web/app/`)

- `apps/web/app/console/layout.tsx` — async server component; auth-gated (reuses Phase A `server-session`), redirects unauthenticated requests to `/login`. Renders the console chrome (header with `LiveBadge` + `ClearModal` trigger + `SampleDataButton` + tab nav) and `{children}`. Mounts the SSE subscription via a single client-side `ConsoleLiveProvider` so all three tabs share one stream.
- `apps/web/app/console/page.tsx` — server component redirecting `/console` → `/console/traces` (so the default tab is unambiguous).
- `apps/web/app/console/traces/page.tsx` — async server component; reads `searchParams` (window, filters, cursor), calls `console-api.fetchTraces` (server-side), passes initial data to `<TracesTab>`.
- `apps/web/app/console/cost/page.tsx` — async server component; same shape, calls `console-api.fetchCost`.
- `apps/web/app/console/replay/page.tsx` — async server component; reads optional `?source=<inference_id>` searchParam, calls `console-api.fetchReplayDetail` when present, passes to `<ReplayTab>`.

### Console components (`apps/web/components/console/`)

- `apps/web/components/console/ConsoleLiveProvider.tsx` — client component; opens the shared `SseClient`, exposes the latest tick via React context so each tab's hook can subscribe to user/kind/conversation-scoped refetch triggers. Closes the socket on unmount.
- `apps/web/components/console/ConsoleHeader.tsx` — pure render: tab nav + `LiveBadge` + `SampleDataButton` + `ClearButton` (trigger only; modal lives in its own file).
- `apps/web/components/console/LiveBadge.tsx` — pure render of the three states; reads from `useLiveBadge`.
- `apps/web/components/console/ClearButton.tsx` — client component: button that opens `ClearModal`; fetches the preview-count on mount of the modal.
- `apps/web/components/console/ClearModal.tsx` — client component: type-CLEAR-to-confirm modal with breakdown counts, "Aborting active operations…" status while the POST resolves, post-success closes and triggers a parent refetch.
- `apps/web/components/console/SampleDataButton.tsx` — client component: triggers `POST /api/console/sample`, shows inline "Generating…" then "Generated N inferences" status, ARIA-live region for screen readers.
- `apps/web/components/console/EmptyState.tsx` — pure render: friendly empty-state message scoped per tab (`scope: 'traces' | 'cost' | 'replay'`), includes deep link to `/chat` and Generate-Samples CTA.
- `apps/web/components/console/TimeWindowToggle.tsx` — pure render: 24h / 7d / all toggle; controlled component, owner is the parent tab.

### Traces tab (`apps/web/components/console/traces/`)

- `apps/web/components/console/traces/TracesTab.tsx` — client component; orchestrates the tab. Reads initial server-fetched data, subscribes to the live tick via `useConsoleLive`, refetches via `console-api.fetchTraces` on tick (debounced), renders header strip + filter bar + feed.
- `apps/web/components/console/traces/ThroughputStrip.tsx` — pure render: turns/hour, tokens/hour, error rate for the active window.
- `apps/web/components/console/traces/ProviderMultiSelect.tsx` — pure render: multi-select chip control for provider filter.
- `apps/web/components/console/traces/ModelMultiSelect.tsx` — pure render: multi-select chip control for model filter.
- `apps/web/components/console/traces/StatusMultiSelect.tsx` — pure render: multi-select for status filter.
- `apps/web/components/console/traces/ConversationMultiSelect.tsx` — pure render: multi-select for conversation filter.
- `apps/web/components/console/traces/FreeTextSearchInput.tsx` — client component: debounced search input.
- `apps/web/components/console/traces/ClearAllFiltersButton.tsx` — pure render: button that emits the empty-filter event.
- `apps/web/components/console/traces/TracesFilterBar.tsx` — client component composing the five sub-controls + clear-all; emits the AND-combined filter object on any change.
- `apps/web/components/console/traces/TraceRow.tsx` — pure render: one row (provider, model, status, latency, prompt/completion tokens, conversation title link, timestamp, Jaeger link, replay badge if `kind=replay`). Expandable to show failover chain.
- `apps/web/components/console/traces/FailoverChain.tsx` — pure render: inline expansion content (per-attempt rows).

### Cost tab (`apps/web/components/console/cost/`)

- `apps/web/components/console/cost/CostTab.tsx` — client component; subscribes to live tick + window + grouping + include-sample + include-replay toggles; refetches on any change; renders header + table.
- `apps/web/components/console/cost/CostHeader.tsx` — pure render: total spend (rounded), sparkline (24h or 7d cadence depending on window), regroup toggle (conversation / provider / model).
- `apps/web/components/console/cost/CostTable.tsx` — pure render: grouped rows, prompt/completion/total columns, mixed-priced badge, sub-cent display, mock + replay row variants, row-click drilldown link.
- `apps/web/components/console/cost/UnpricedBadge.tsx` — pure render: "(N rows missing pricing)" with hover/popover listing the unpriced models.
- `apps/web/components/console/cost/Sparkline.tsx` — pure render: minimal inline SVG, takes a number array.

### Replay tab (`apps/web/components/console/replay/`)

- `apps/web/components/console/replay/ReplayTab.tsx` — client component; manages selected target provider/model state, replay-run state machine (`idle | running | success | failed`), renders picker or detail view.
- `apps/web/components/console/replay/ReplayPicker.tsx` — pure render: candidate list filtered by Traces window (passed in as prop), each candidate clickable to select.
- `apps/web/components/console/replay/ReplayDetail.tsx` — client component: original metadata block + provider/model selectors + side-by-side pane + diff toggle + reset-to-original button.
- `apps/web/components/console/replay/ProviderModelPicker.tsx` — pure render: independent provider + model dropdowns, unavailable providers disabled with tooltip + "switch to Mock" CTA. Reads its `{ provider → models[] }` catalog from the `ProviderAvailabilityResponseSchema` payload (single source of truth: backend ships the snapshot pricing-derived catalog).
- `apps/web/components/console/replay/RunReplayButton.tsx` — pure render: triggers the replay-run state machine; disabled while running.
- `apps/web/components/console/replay/DiffToggle.tsx` — pure render: toggles between `raw` and `diff` view of the side-by-side pane.
- `apps/web/components/console/replay/PaneExpandControl.tsx` — pure render: button that opens a full-screen scrollable detail of one pane.
- `apps/web/components/console/replay/ResetToOriginalButton.tsx` — pure render: restores the picker's provider/model to the source row's values.
- `apps/web/components/console/replay/SideBySidePane.tsx` — pure render: two-column layout with per-pane expand control, accepts `original` + `replay` content props + diff payload + display mode (`raw | diff`).
- `apps/web/components/console/replay/DiffRenderer.tsx` — pure render: applies the precomputed diff payload (from the server, per HLD D4) to produce highlighted word-level spans. Server-side diff is the default; this component is a renderer, not a computer.
- `apps/web/components/console/replay/ReplayErrorMessage.tsx` — pure render: inline failure message for the pane when either side has no output (e.g. "Original was canceled — no output to compare").

### Library code (`apps/web/lib/`)

- `apps/web/lib/sse-client.ts` — typed SSE client class per the SSE client model section above; exports `SseClient`, `defaultSseUrl()`, error reason types. Mirrors `ws-client.ts` conventions exactly.
- `apps/web/lib/console-api.ts` — typed REST client for the Phase B endpoints. Server-side helpers (`fetchTraces`, `fetchCost`, `fetchReplayCandidates`, `fetchReplayDetail`, `fetchProviderAvailability`) use Phase A's `server-api-fetch`. Browser-side helpers (`runReplay`, `generateSample`, `previewClear`, `executeClear`, `fetchBadgeLag`, plus a browser-callable variant of `fetchProviderAvailability` for replay's `ProviderModelPicker`) use Phase A's `auth-fetch`. Each helper parses the response with the matching `@argus/contracts` schema before returning. Server-only helpers import `server-only` so accidental client imports fail at build.
- `apps/web/lib/derive-live-badge-state.ts` — pure function turning `{ lagMs, queryError, thresholds: { greenMs, errorMs } }` into a `{ state: 'live' | 'behind' | 'error', label: string }` shape.
- `apps/web/lib/use-live-badge.ts` — React hook: polls `console-api.fetchBadgeLag` on a fixed cadence (default 1s, configurable), runs `derive-live-badge-state`, returns the derived shape. Surfaces fetch errors as `state: 'error'`. Guards against late responses after unmount.
- `apps/web/lib/use-console-live.ts` — React hook: reads from `ConsoleLiveProvider`'s context, returns the latest tick + a subscription helper so each tab can register a debounced refetch.
- `apps/web/lib/use-debounced-callback.ts` — small utility hook (trailing-edge debounce) used by tab refetch hooks to absorb Generate-Samples burst storms.
- `apps/web/lib/traces-filter-encoding.ts` — pure helpers exposing encode (filter → URLSearchParams) and decode (URLSearchParams → filter) functions; round-trippable, deterministic key order.

### Test files (`apps/web/__tests__/` mirrors source path exactly)

- `apps/web/__tests__/lib/sse-client.test.ts`
- `apps/web/__tests__/lib/console-api.test.ts`
- `apps/web/__tests__/lib/derive-live-badge-state.test.ts`
- `apps/web/__tests__/lib/use-live-badge.test.ts`
- `apps/web/__tests__/lib/use-console-live.test.ts`
- `apps/web/__tests__/lib/use-debounced-callback.test.ts`
- `apps/web/__tests__/lib/traces-filter-encoding.test.ts`
- `apps/web/__tests__/components/console/LiveBadge.test.tsx`
- `apps/web/__tests__/components/console/ClearModal.test.tsx`
- `apps/web/__tests__/components/console/SampleDataButton.test.tsx`
- `apps/web/__tests__/components/console/EmptyState.test.tsx`
- `apps/web/__tests__/components/console/TimeWindowToggle.test.tsx`
- `apps/web/__tests__/components/console/traces/ThroughputStrip.test.tsx`
- `apps/web/__tests__/components/console/traces/ProviderMultiSelect.test.tsx`
- `apps/web/__tests__/components/console/traces/ModelMultiSelect.test.tsx`
- `apps/web/__tests__/components/console/traces/StatusMultiSelect.test.tsx`
- `apps/web/__tests__/components/console/traces/ConversationMultiSelect.test.tsx`
- `apps/web/__tests__/components/console/traces/FreeTextSearchInput.test.tsx`
- `apps/web/__tests__/components/console/traces/ClearAllFiltersButton.test.tsx`
- `apps/web/__tests__/components/console/traces/TracesFilterBar.test.tsx`
- `apps/web/__tests__/components/console/traces/TracesTab.test.tsx`
- `apps/web/__tests__/components/console/traces/TraceRow.test.tsx`
- `apps/web/__tests__/components/console/traces/FailoverChain.test.tsx`
- `apps/web/__tests__/components/console/cost/CostHeader.test.tsx`
- `apps/web/__tests__/components/console/cost/CostTable.test.tsx`
- `apps/web/__tests__/components/console/cost/UnpricedBadge.test.tsx`
- `apps/web/__tests__/components/console/cost/Sparkline.test.tsx`
- `apps/web/__tests__/components/console/cost/CostTab.test.tsx`
- `apps/web/__tests__/components/console/replay/ReplayPicker.test.tsx`
- `apps/web/__tests__/components/console/replay/ProviderModelPicker.test.tsx`
- `apps/web/__tests__/components/console/replay/DiffRenderer.test.tsx`
- `apps/web/__tests__/components/console/replay/ReplayErrorMessage.test.tsx`
- `apps/web/__tests__/components/console/replay/ReplayTab.test.tsx`
- `packages/contracts/__tests__/live-events.test.ts`
- `packages/contracts/__tests__/console.test.ts`

---

## Tasks

> Verify commands assume repo root (`/Users/lego/Desktop/personal-projects/argus`) as the working directory. Package filter syntax is `pnpm --filter @argus/web <script>`. Per-test-file filtering uses `pnpm --filter @argus/web test -- <pathOrPattern>`.

### Phase 0: Contract round-trip verification (frontend-web owns one happy-path round-trip per schema; backend-api LLD owns the authoring)

#### Task 1A (RED): Failing tests for `LiveEventSchema` + console row schemas round-trip
**Files:** `packages/contracts/jest.config.js`, `packages/contracts/__tests__/live-events.test.ts`, `packages/contracts/__tests__/console.test.ts`
**What to do:** Create the Jest config for `@argus/contracts` mirroring the `apps/web` ts-jest preset (no jsdom — node env). Write one happy-path round-trip test per schema named in the Coordinated contract exports section (LiveEvent tick variant, LiveEvent heartbeat variant, LiveEventKindEnum, TraceRow, TraceListResponse, CostGroup, CostResponse, ReplayCandidate, ReplayDetail, ReplayRunRequest, ReplayRunResponse, SampleGenerateResponse, ClearPreviewResponse, ClearExecuteRequest, ProviderSelection, TimeWindow, ProviderAvailabilityResponse, BadgeLagResponse). Each test parses a representative valid payload and rejects a payload missing one required field.
**Acceptance:** All tests run and fail because the schemas do not yet exist (backend-api LLD authors them).
**Verify:** `pnpm --filter @argus/contracts test` reports the expected failures.

#### Task 1B (GREEN coordination): Confirm schemas land and round-trip tests pass
**Files:** none (coordination task — verify backend-api LLD's contract-authoring tasks have landed)
**What to do:** After backend-api worker lands `packages/contracts/src/live-events.ts` and `packages/contracts/src/console.ts`, re-run Task 1A's tests. Also add an export-presence sanity test that imports each named export from `@argus/contracts` and asserts it is defined. If a schema name drifted from this LLD's spec, raise it to the lead — do NOT silently rename in `apps/web/`.
**Acceptance:** All Task 1A tests pass; `@argus/contracts` exports every name listed in the Coordinated contract exports section, verified by import.
**Verify:** `pnpm --filter @argus/contracts test`.

---

### Phase 1: SSE client (RED → GREEN pairs)

#### Task 2 (RED): `SseClient` constructor opens a connection to the configured URL with credentials forwarded
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: instantiating the client with a URL and a credentials flag opens an EventSource to that URL with credentials forwarded.
**Acceptance:** SSE client opens connection with the configured URL and credentials flag.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the expected failure.

#### Task 3 (GREEN): Implement `SseClient` constructor + `close()`
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Create the class with constructor that opens an `EventSource` per Task 2 and a `close()` method that closes the underlying source.
**Acceptance:** Task 2 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 4 (RED): `SseClient` validates inbound events and dispatches well-formed payloads to the event handler
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: well-formed `LiveEvent` payloads arriving on the underlying source are dispatched to the registered event handler with the parsed object; payloads missing a required field are NOT dispatched to the event handler and surface to the error handler with a validation reason.
**Acceptance:** Valid events reach the event handler; invalid events reach the error handler with `reason: 'validation'`.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 5 (GREEN): Implement inbound event validation
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Parse incoming `data` as JSON, validate against `LiveEventSchema` from `@argus/contracts`, route valid events to the event handler and invalid ones to the error handler with a structured reason. Mirror the error shape used by `ws-client.ts` (reason + message + raw payload).
**Acceptance:** Task 4 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 6 (RED): `SseClient` malformed JSON triggers the error handler (no throw)
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: a message whose `data` is non-JSON triggers the error handler with `reason: 'parse'` and does not throw out of the dispatcher.
**Acceptance:** Malformed JSON surfaces to the error handler; dispatcher never throws.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 7 (GREEN): Catch JSON parse failures
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Wrap JSON parsing in a try/catch and route failure to the error handler.
**Acceptance:** Task 6 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 8 (RED): `SseClient` transport `error` event forwarded with `reason: 'transport'`
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: a transport-level error event on the underlying source forwards to the error handler with `reason: 'transport'` plus the source's `readyState` so callers can distinguish reconnecting from permanently closed.
**Acceptance:** Transport errors reach the error handler with the transport reason and readyState.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 9 (GREEN): Wire transport error
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Forward transport errors per Task 8 including readyState.
**Acceptance:** Task 8 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 10 (RED): `SseClient` open handler fires on first open
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: the registered open handler runs exactly once when the underlying source opens.
**Acceptance:** Open handler fires exactly once per open event.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 11 (GREEN): Wire open handler
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Implement per Task 10.
**Acceptance:** Task 10 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 12 (RED): `SseClient.close()` suppresses subsequent handler invocations and is idempotent
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: after close, no further inbound events or transport errors reach the registered handlers; the underlying source is closed exactly once even if close is called multiple times.
**Acceptance:** Post-close handler invocations are suppressed; close is idempotent.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 13 (GREEN): Implement handler suppression after close
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Track a closed flag, guard each dispatcher, and ensure close is idempotent.
**Acceptance:** Task 12 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

#### Task 14 (RED): `defaultSseUrl` honors `NEXT_PUBLIC_SSE_URL` else falls back
**Files:** `apps/web/__tests__/lib/sse-client.test.ts`
**What to do:** Failing test for the behavior: when `process.env.NEXT_PUBLIC_SSE_URL` is set, `defaultSseUrl()` returns that value; when unset or empty, returns `/api/console/live`.
**Acceptance:** Environment override is honored; default fallback is `/api/console/live`.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts` reports the new failure.

#### Task 15 (GREEN): Implement `defaultSseUrl`
**Files:** `apps/web/lib/sse-client.ts`
**What to do:** Export the helper per Task 14.
**Acceptance:** Task 14 passes.
**Verify:** `pnpm --filter @argus/web test -- sse-client.test.ts`.

---

### Phase 2: LiveBadge state derivation (pure function + hook)

#### Task 16 (RED): `derive-live-badge-state` returns `live` when lag is under the green threshold
**Files:** `apps/web/__tests__/lib/derive-live-badge-state.test.ts`
**What to do:** Failing test for the behavior: a lag well below the green threshold with no query error derives the `live` state and the literal label "Live".
**Acceptance:** Sub-green-threshold lag derives `{ state: 'live', label: 'Live' }`.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts` reports the expected failure.

#### Task 17 (GREEN): Implement `live` branch
**Files:** `apps/web/lib/derive-live-badge-state.ts`
**What to do:** Implement the pure function with the `live` branch only.
**Acceptance:** Task 16 passes.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts`.

#### Task 18 (RED): `derive-live-badge-state` returns `behind` with integer-rounded seconds and treats the green threshold as the boundary into amber
**Files:** `apps/web/__tests__/lib/derive-live-badge-state.test.ts`
**What to do:** Failing test for two behaviors: a lag between the green and error thresholds derives the `behind` state with a label containing the lag rounded down to whole seconds; a lag exactly at the green threshold also derives `behind` (boundary belongs to amber).
**Acceptance:** Mid-range lag derives `behind` with integer-second label; green-threshold boundary derives `behind`.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts` reports the new failure.

#### Task 19 (GREEN): Implement `behind` branch
**Files:** `apps/web/lib/derive-live-badge-state.ts`
**What to do:** Extend the function per Task 18; floor the lag to whole seconds for the label.
**Acceptance:** Task 18 passes.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts`.

#### Task 20 (RED): `derive-live-badge-state` returns `error` when lag is at or above the error threshold
**Files:** `apps/web/__tests__/lib/derive-live-badge-state.test.ts`
**What to do:** Failing test for the behavior: a lag at or above the error threshold derives the `error` state with a label mentioning ingestion failure.
**Acceptance:** At-or-above-error-threshold lag derives `error` with the ingestion-failure label.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts` reports the new failure.

#### Task 21 (GREEN): Implement `error` branch (lag-based)
**Files:** `apps/web/lib/derive-live-badge-state.ts`
**What to do:** Extend the function per Task 20.
**Acceptance:** Task 20 passes.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts`.

#### Task 22 (RED): `derive-live-badge-state` returns `error` when query error is non-null regardless of lag
**Files:** `apps/web/__tests__/lib/derive-live-badge-state.test.ts`
**What to do:** Failing test for the behavior: a query error always derives `error`, even when lag is small enough to otherwise be `live`.
**Acceptance:** Query error dominates lag and forces `error`.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts` reports the new failure.

#### Task 23 (GREEN): Implement query-error precedence
**Files:** `apps/web/lib/derive-live-badge-state.ts`
**What to do:** Add the early-return for non-null `queryError` at the top of the function.
**Acceptance:** Task 22 passes.
**Verify:** `pnpm --filter @argus/web test -- derive-live-badge-state.test.ts`.

#### Task 24 (RED): `useLiveBadge` polls `console-api.fetchBadgeLag` on the configured cadence
**Files:** `apps/web/__tests__/lib/use-live-badge.test.ts`
**What to do:** Failing test for the behavior: on mount, the hook makes the initial badge-lag fetch and exposes the derived state; on each cadence tick it makes another fetch.
**Acceptance:** Hook fetches on mount and re-fetches once per cadence tick.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts` reports the expected failure.

#### Task 25 (GREEN): Implement `useLiveBadge`
**Files:** `apps/web/lib/use-live-badge.ts`
**What to do:** Implement the hook: on mount fetch once, then schedule a fixed-cadence interval (default 1000ms, prop-overridable). Each tick fetches, runs the derivation, sets state. Clear the interval on unmount.
**Acceptance:** Task 24 passes.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts`.

#### Task 26 (RED): `useLiveBadge` surfaces fetch errors as `state: 'error'`
**Files:** `apps/web/__tests__/lib/use-live-badge.test.ts`
**What to do:** Failing test for the behavior: when the badge-lag fetch rejects, the hook surfaces `state: 'error'` with the ingestion-failure label.
**Acceptance:** Fetch rejection surfaces as `error` state.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts` reports the new failure.

#### Task 27 (GREEN): Wire fetch-error → derivation with `queryError`
**Files:** `apps/web/lib/use-live-badge.ts`
**What to do:** Wrap the fetch in a try/catch and pass the captured error as `queryError` into the derivation when caught.
**Acceptance:** Task 26 passes.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts`.

#### Task 28 (RED): `useLiveBadge` ignores late responses after unmount
**Files:** `apps/web/__tests__/lib/use-live-badge.test.ts`
**What to do:** Failing test for the behavior: a fetch that resolves AFTER the hook has unmounted does not trigger a state update and produces no act/setState-after-unmount warning.
**Acceptance:** Post-unmount fetch resolutions are dropped silently with no state update.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts` reports the new failure.

#### Task 29 (GREEN): Guard `useLiveBadge` against late responses
**Files:** `apps/web/lib/use-live-badge.ts`
**What to do:** Track a mounted ref (or use an AbortController on the fetch); skip state updates when unmounted; clear pending work in the effect cleanup.
**Acceptance:** Task 28 passes.
**Verify:** `pnpm --filter @argus/web test -- use-live-badge.test.ts`.

#### Task 30 (RED): `<LiveBadge />` renders the three visual states from a stubbed hook
**Files:** `apps/web/__tests__/components/console/LiveBadge.test.tsx`
**What to do:** Failing test for the behavior: each of the three states (`live`, `behind` with a label, `error`) renders with a distinct accessible status and label; the error variant exposes a Retry control.
**Acceptance:** All three visual states render with distinct accessible affordances; error state includes Retry.
**Verify:** `pnpm --filter @argus/web test -- LiveBadge.test.tsx` reports the expected failure.

#### Task 31 (GREEN): Implement `<LiveBadge />`
**Files:** `apps/web/components/console/LiveBadge.tsx`
**What to do:** Render the three visual states inside an `aria-live="polite"` wrapper; the error variant exposes a Retry button that calls the refetch API returned by `useLiveBadge`.
**Acceptance:** Task 30 passes.
**Verify:** `pnpm --filter @argus/web test -- LiveBadge.test.tsx`.

---

### Phase 3: Console API client + supporting helpers

#### Task 32 (RED): `console-api.fetchTraces` request path, filter encoding, response validation
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a GET to `/api/console/traces` with window and filters as query params and returns the response parsed via `TraceListResponseSchema`.
**Acceptance:** Outbound URL matches the expected path and query encoding; response is schema-validated.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the expected failure.

#### Task 33 (GREEN): Implement `console-api.fetchTraces`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 32 using `server-api-fetch` and `TraceListResponseSchema.parse` on the body.
**Acceptance:** Task 32 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 34 (RED): `console-api.fetchTraces` encodes repeated multi-value filter keys correctly
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: filters with multi-value fields (e.g. multiple statuses) appear as repeated query keys (`status=succeeded&status=failed`), preserving every value.
**Acceptance:** Multi-value filters become repeated query params with every value preserved.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 35 (GREEN): Wire multi-value filter encoding into `fetchTraces`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Use the `traces-filter-encoding.encode` helper (built in Phase 4) so multi-value filters round-trip cleanly. If Phase 4 hasn't landed yet, inline equivalent logic and replace once it lands.
**Acceptance:** Task 34 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 36 (RED): `console-api.fetchCost` request shape + response validation
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a GET to `/api/console/cost` with window, group-by, include-sample, and include-replay as query params and returns the response parsed via `CostResponseSchema`.
**Acceptance:** Outbound URL/query match expectation; response is schema-validated.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 37 (GREEN): Implement `fetchCost`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 36.
**Acceptance:** Task 36 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 38 (RED): `console-api.fetchReplayCandidates` + `fetchReplayDetail` request shapes
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for two behaviors: candidates fetch issues a GET to `/api/console/replay/candidates` with a window query param; detail fetch issues a GET to `/api/console/replay/:id` with the inference id in the path. Both responses are schema-validated.
**Acceptance:** Both helpers hit the expected paths and parse with the matching schemas.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the expected failures.

#### Task 39 (GREEN): Implement replay fetchers
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 38.
**Acceptance:** Task 38 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 40 (RED): `console-api.runReplay` POSTs and parses the response
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a POST to `/api/console/replay` whose body matches `ReplayRunRequestSchema` and parses the response via `ReplayRunResponseSchema`.
**Acceptance:** Outbound POST body matches the request schema; response is schema-validated.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 41 (GREEN): Implement `runReplay`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 40 using the browser-side `auth-fetch`.
**Acceptance:** Task 40 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 42 (RED): `console-api.generateSample` POSTs and parses response
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a POST to `/api/console/sample` and parses the response via `SampleGenerateResponseSchema`.
**Acceptance:** Outbound POST hits the right path; response is schema-validated.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 43 (GREEN): Implement `generateSample`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 42 using `auth-fetch`.
**Acceptance:** Task 42 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 44 (RED): `console-api.previewClear` GETs and parses response
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a GET to `/api/console/clear/preview` and parses the response via `ClearPreviewResponseSchema`.
**Acceptance:** Outbound GET hits the right path; response is schema-validated.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 45 (GREEN): Implement `previewClear`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 44 using `auth-fetch`.
**Acceptance:** Task 44 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 46 (RED): `console-api.executeClear` POSTs with the `CLEAR` confirmation literal
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a POST to `/api/console/clear` whose body matches `ClearExecuteRequestSchema` carrying the literal `'CLEAR'` confirmation.
**Acceptance:** Outbound POST body carries the literal confirmation.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 47 (GREEN): Implement `executeClear`
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Implement per Task 46 using `auth-fetch`.
**Acceptance:** Task 46 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 48 (RED): `console-api.fetchProviderAvailability` GETs and parses response (server + client variants)
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the server-side variant uses `server-api-fetch` and the browser-side variant uses `auth-fetch`; both issue a GET to `/api/providers/availability` and both parse the response via `ProviderAvailabilityResponseSchema`. The browser variant is callable from `useEffect` in client components (the replay tab's `ProviderModelPicker`) without importing server-only code.
**Acceptance:** Both variants exist, hit the right path, parse with the right schema, and the browser variant does not transitively import `server-only`.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 49 (GREEN): Implement availability fetcher (both variants)
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Export two functions: `fetchProviderAvailabilityServer` (server-only) and `fetchProviderAvailability` (client-safe). The server file uses `server-only` import; the client function lives in the same module but does not transitively pull `server-only` into client bundles (split into two sub-modules if needed, e.g. `console-api.server.ts` + `console-api.client.ts`, both re-exported from `console-api.ts` selectively).
**Acceptance:** Task 48 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 50 (RED): `console-api.fetchBadgeLag` GETs and parses response (client-safe)
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: the helper issues a GET to `/api/console/live/badge` from the browser using `auth-fetch` and parses the response via `BadgeLagResponseSchema`; the helper is importable from a client component without dragging in `server-only`.
**Acceptance:** Browser-side helper hits the right path, parses the right schema, and is client-safe.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 51 (GREEN): Implement `fetchBadgeLag`
**Files:** `apps/web/lib/console-api.ts` (client side)
**What to do:** Implement per Task 50.
**Acceptance:** Task 50 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

#### Task 52 (RED): `console-api` helpers propagate `ApiError` + `AuthError` from underlying fetchers
**Files:** `apps/web/__tests__/lib/console-api.test.ts`
**What to do:** Failing test for the behavior: when the underlying fetcher throws `AuthError` or `ApiError`, the console-api helper rethrows without wrapping or swallowing. Callers decide UX.
**Acceptance:** Errors from the underlying fetch layer surface unchanged.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts` reports the new failure.

#### Task 53 (GREEN): Ensure error propagation is unwrapped
**Files:** `apps/web/lib/console-api.ts`
**What to do:** Audit the helpers; if any helper wraps in try/catch, remove the wrap.
**Acceptance:** Task 52 passes.
**Verify:** `pnpm --filter @argus/web test -- console-api.test.ts`.

---

### Phase 4: Filter encoding + debounce utility

#### Task 54 (RED): `traces-filter-encoding.encode` produces deterministic key order and is reversible
**Files:** `apps/web/__tests__/lib/traces-filter-encoding.test.ts`
**What to do:** Failing test for two behaviors: the stringified URLSearchParams has a deterministic key order (alphabetical or a fixed sequence — pick one and commit to it); decode-of-encode is identity for every filter shape including empty.
**Acceptance:** Encoded output has stable key order; round-trip is identity.
**Verify:** `pnpm --filter @argus/web test -- traces-filter-encoding.test.ts` reports the expected failure.

#### Task 55 (GREEN): Implement filter encoding
**Files:** `apps/web/lib/traces-filter-encoding.ts`
**What to do:** Implement the encode (filter → URLSearchParams) and decode (URLSearchParams → filter) functions per Task 54. Multi-value filters use repeated keys; empty filter produces empty params.
**Acceptance:** Task 54 passes.
**Verify:** `pnpm --filter @argus/web test -- traces-filter-encoding.test.ts`.

#### Task 56 (RED): `traces-filter-encoding.decode` drops unknown keys silently
**Files:** `apps/web/__tests__/lib/traces-filter-encoding.test.ts`
**What to do:** Failing test for the behavior: URLSearchParams containing unknown keys decode without errors, with the unknown keys dropped from the resulting filter object.
**Acceptance:** Unknown keys are dropped silently.
**Verify:** `pnpm --filter @argus/web test -- traces-filter-encoding.test.ts` reports the new failure.

#### Task 57 (GREEN): Drop unknown keys on decode
**Files:** `apps/web/lib/traces-filter-encoding.ts`
**What to do:** Maintain an allow-list of known filter keys; ignore everything else.
**Acceptance:** Task 56 passes.
**Verify:** `pnpm --filter @argus/web test -- traces-filter-encoding.test.ts`.

#### Task 58 (RED): `use-debounced-callback` trailing-edge debounces under burst
**Files:** `apps/web/__tests__/lib/use-debounced-callback.test.ts`
**What to do:** Failing test for the behavior: rapid back-to-back invocations of the returned function fire the underlying callback exactly once at the configured debounce window boundary.
**Acceptance:** Debounce fires exactly once at the configured window boundary under burst.
**Verify:** `pnpm --filter @argus/web test -- use-debounced-callback.test.ts` reports the expected failure.

#### Task 59 (GREEN): Implement `use-debounced-callback`
**Files:** `apps/web/lib/use-debounced-callback.ts`
**What to do:** Implement the trailing-edge debounce hook with a stable returned function. Clear pending timeout on unmount.
**Acceptance:** Task 58 passes.
**Verify:** `pnpm --filter @argus/web test -- use-debounced-callback.test.ts`.

#### Task 60 (RED): `use-debounced-callback` cleanup on unmount aborts pending invocation
**Files:** `apps/web/__tests__/lib/use-debounced-callback.test.ts`
**What to do:** Failing test for the behavior: unmounting before the debounce window elapses cancels the pending invocation; the underlying callback is never called.
**Acceptance:** Pending invocation is cancelled on unmount.
**Verify:** `pnpm --filter @argus/web test -- use-debounced-callback.test.ts` reports the new failure.

#### Task 61 (GREEN): Clear pending timeout on unmount
**Files:** `apps/web/lib/use-debounced-callback.ts`
**What to do:** Return a cleanup from the effect that clears the pending timeout.
**Acceptance:** Task 60 passes.
**Verify:** `pnpm --filter @argus/web test -- use-debounced-callback.test.ts`.

---

### Phase 5: `useConsoleLive` hook + `ConsoleLiveProvider`

#### Task 62 (RED): `useConsoleLive` exposes the latest tick when one arrives via context
**Files:** `apps/web/__tests__/lib/use-console-live.test.ts`
**What to do:** Failing test for the behavior: when the provider's underlying SSE client receives a tick, the hook's `latestTick` reflects that payload.
**Acceptance:** Hook surfaces the latest tick from the provider's SSE client.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts` reports the expected failure.

#### Task 63 (GREEN): Implement `ConsoleLiveProvider` + `useConsoleLive`
**Files:** `apps/web/components/console/ConsoleLiveProvider.tsx`, `apps/web/lib/use-console-live.ts`
**What to do:** Provider opens an `SseClient` (accepts an optional injectable client for tests), maintains the latest tick in state, exposes it via context. Hook reads context, throws a clear error if used outside the provider.
**Acceptance:** Task 62 passes.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts`.

#### Task 64 (RED): `useConsoleLive.subscribe` invokes callback only for matching predicate
**Files:** `apps/web/__tests__/lib/use-console-live.test.ts`
**What to do:** Failing test for the behavior: subscribers registered with a predicate receive only events whose payload matches that predicate (e.g. `kind === 'chat'` vs `kind === 'classifier'`).
**Acceptance:** Predicate-filtered subscription only fires for matching events.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts` reports the new failure.

#### Task 65 (GREEN): Implement `subscribe` with predicate filtering
**Files:** `apps/web/lib/use-console-live.ts`
**What to do:** Expose a subscription helper that takes a predicate and a callback and returns an unsubscribe function; on each tick, fire only matching callbacks.
**Acceptance:** Task 64 passes.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts`.

#### Task 66 (RED): `ConsoleLiveProvider` closes the SSE client on unmount
**Files:** `apps/web/__tests__/lib/use-console-live.test.ts`
**What to do:** Failing test for the behavior: unmounting the provider closes the underlying SSE client exactly once.
**Acceptance:** Provider unmount closes the SSE client exactly once.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts` reports the new failure.

#### Task 67 (GREEN): Wire close in cleanup
**Files:** `apps/web/components/console/ConsoleLiveProvider.tsx`
**What to do:** Return a cleanup from the mount effect that calls the client's close method.
**Acceptance:** Task 66 passes.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts`.

#### Task 68 (RED): `ConsoleLiveProvider` ignores invalid events from the SSE client
**Files:** `apps/web/__tests__/lib/use-console-live.test.ts`
**What to do:** Failing test for the behavior: when the SSE client surfaces an error (validation or transport), the provider does NOT update `latestTick`; only well-formed events advance the context value.
**Acceptance:** Provider only advances on valid ticks; SSE errors do not poison the context.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts` reports the new failure.

#### Task 69 (GREEN): Filter SSE errors out of the provider context
**Files:** `apps/web/components/console/ConsoleLiveProvider.tsx`
**What to do:** Register only the event handler with the SSE client for the context state; route the error handler to a no-op (or to a logger) without touching context.
**Acceptance:** Task 68 passes.
**Verify:** `pnpm --filter @argus/web test -- use-console-live.test.ts`.

---

### Phase 6: Shared console controls (pure components)

#### Task 70 (RED): `<EmptyState />` renders scope-appropriate copy + CTAs
**Files:** `apps/web/__tests__/components/console/EmptyState.test.tsx`
**What to do:** Failing test for three behaviors: traces / cost / replay scopes each render their own empty copy plus a link to `/chat` and a Generate-Samples CTA.
**Acceptance:** Each scope renders distinct copy with the deep link and CTA.
**Verify:** `pnpm --filter @argus/web test -- EmptyState.test.tsx` reports the expected failures.

#### Task 71 (GREEN): Implement `<EmptyState />`
**Files:** `apps/web/components/console/EmptyState.tsx`
**What to do:** Implement the pure component with a scope-keyed copy table; render the chat link and the Generate-Samples CTA (the latter wired to call the `onGenerateSamples` prop).
**Acceptance:** Task 70 passes.
**Verify:** `pnpm --filter @argus/web test -- EmptyState.test.tsx`.

#### Task 72 (RED): `<TimeWindowToggle />` controlled component emits the new value on click and exposes pressed state
**Files:** `apps/web/__tests__/components/console/TimeWindowToggle.test.tsx`
**What to do:** Failing test for the behavior: clicking a window option emits the corresponding value to the change handler; the currently selected option carries `aria-pressed="true"`.
**Acceptance:** Click emits the selected value; pressed state is announced via aria-pressed.
**Verify:** `pnpm --filter @argus/web test -- TimeWindowToggle.test.tsx` reports the expected failure.

#### Task 73 (GREEN): Implement `<TimeWindowToggle />`
**Files:** `apps/web/components/console/TimeWindowToggle.tsx`
**What to do:** Implement the controlled component with three window options.
**Acceptance:** Task 72 passes.
**Verify:** `pnpm --filter @argus/web test -- TimeWindowToggle.test.tsx`.

#### Task 74 (RED): `<SampleDataButton />` click triggers generation and surfaces interim + success status
**Files:** `apps/web/__tests__/components/console/SampleDataButton.test.tsx`
**What to do:** Failing test for the behavior: clicking the button shows an interim "Generating…" status; on success the status updates to a count-aware "Generated N inferences" message; both messages live inside an `aria-live="polite"` region.
**Acceptance:** Interim and success statuses are visible and live-announced.
**Verify:** `pnpm --filter @argus/web test -- SampleDataButton.test.tsx` reports the expected failure.

#### Task 75 (GREEN): Implement `<SampleDataButton />`
**Files:** `apps/web/components/console/SampleDataButton.tsx`
**What to do:** Implement per Task 74 with internal `idle | generating | done | error` state and the live region.
**Acceptance:** Task 74 passes.
**Verify:** `pnpm --filter @argus/web test -- SampleDataButton.test.tsx`.

#### Task 76 (RED): `<SampleDataButton />` failure surfaces inline error and re-enables the button
**Files:** `apps/web/__tests__/components/console/SampleDataButton.test.tsx`
**What to do:** Failing test for the behavior: a rejected generation surfaces an inline error message and re-enables the button for retry.
**Acceptance:** Error surfaces inline; button is re-enabled.
**Verify:** `pnpm --filter @argus/web test -- SampleDataButton.test.tsx` reports the new failure.

#### Task 77 (GREEN): Handle rejection
**Files:** `apps/web/components/console/SampleDataButton.tsx`
**What to do:** Add the rejection path: render the error, return to idle so the button is clickable.
**Acceptance:** Task 76 passes.
**Verify:** `pnpm --filter @argus/web test -- SampleDataButton.test.tsx`.

#### Task 78 (RED): `<ClearModal />` requires typing `CLEAR` exactly to enable the destructive button
**Files:** `apps/web/__tests__/components/console/ClearModal.test.tsx`
**What to do:** Failing test for the behavior: the destructive button is disabled until the user types the literal `CLEAR`; case mismatch keeps it disabled.
**Acceptance:** Destructive button is gated on the strict `CLEAR` literal.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx` reports the expected failure.

#### Task 79 (GREEN): Implement `<ClearModal />` confirmation gating
**Files:** `apps/web/components/console/ClearModal.tsx`
**What to do:** Render the modal with the text input; enable the destructive button only when the input value strictly equals `'CLEAR'`.
**Acceptance:** Task 78 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx`.

#### Task 80 (RED): `<ClearModal />` shows breakdown counts from preview response
**Files:** `apps/web/__tests__/components/console/ClearModal.test.tsx`
**What to do:** Failing test for the behavior: the preview response's per-kind counts are rendered as accessible text alongside a total.
**Acceptance:** Breakdown counts and total are rendered from the preview response.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx` reports the new failure.

#### Task 81 (GREEN): Wire preview fetch + breakdown render
**Files:** `apps/web/components/console/ClearModal.tsx`
**What to do:** On mount call `console-api.previewClear`; render the breakdown per Task 80; show a loading skeleton until the preview resolves.
**Acceptance:** Task 80 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx`.

#### Task 82 (RED): `<ClearModal />` confirmed submit shows in-flight status then closes on success
**Files:** `apps/web/__tests__/components/console/ClearModal.test.tsx`
**What to do:** Failing test for the behavior: while the destructive POST is pending, an "Aborting active operations…" status is visible; on success the modal calls its close and cleared callbacks.
**Acceptance:** In-flight status is visible during the POST; success triggers the close and cleared callbacks.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx` reports the new failure.

#### Task 83 (GREEN): Wire submit flow
**Files:** `apps/web/components/console/ClearModal.tsx`
**What to do:** Implement per Task 82.
**Acceptance:** Task 82 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx`.

#### Task 84 (RED): `<ClearModal />` Cancel button always available; never invokes execute
**Files:** `apps/web/__tests__/components/console/ClearModal.test.tsx`
**What to do:** Failing test for the behavior: clicking Cancel never invokes the execute helper and always calls the close callback, both before and after typing `CLEAR`.
**Acceptance:** Cancel always closes without executing.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx` reports the new failure.

#### Task 85 (GREEN): Wire Cancel
**Files:** `apps/web/components/console/ClearModal.tsx`
**What to do:** Add the Cancel button; on click call the close callback directly.
**Acceptance:** Task 84 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx`.

#### Task 86 (RED): `<ClearModal />` surfaces a recoverable error when execute rejects
**Files:** `apps/web/__tests__/components/console/ClearModal.test.tsx`
**What to do:** Failing test for the behavior: a rejected execute call surfaces an inline error message inside the modal, re-enables the destructive button so the user can retry, and does NOT invoke the cleared callback.
**Acceptance:** Execute failure renders inline error and remains retryable; cleared callback is not fired.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx` reports the new failure.

#### Task 87 (GREEN): Handle execute rejection
**Files:** `apps/web/components/console/ClearModal.tsx`
**What to do:** Wrap the execute call in try/catch; on rejection surface the error message and return the modal to the gated-confirm state.
**Acceptance:** Task 86 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearModal.test.tsx`.

---

### Phase 7: Traces tab components (RED → GREEN pairs)

#### Task 88 (RED): `<ThroughputStrip />` renders three metrics from props
**Files:** `apps/web/__tests__/components/console/traces/ThroughputStrip.test.tsx`
**What to do:** Failing test for the behavior: the strip renders accessible text for turns/hour, tokens/hour (locale-formatted), and error rate as a percentage.
**Acceptance:** All three metrics render with the expected formatting.
**Verify:** `pnpm --filter @argus/web test -- ThroughputStrip.test.tsx` reports the expected failure.

#### Task 89 (GREEN): Implement `<ThroughputStrip />`
**Files:** `apps/web/components/console/traces/ThroughputStrip.tsx`
**What to do:** Implement per Task 88; use locale-aware number formatting for the token count.
**Acceptance:** Task 88 passes.
**Verify:** `pnpm --filter @argus/web test -- ThroughputStrip.test.tsx`.

#### Task 90 (RED): `<ProviderMultiSelect />` emits the new array on selection change
**Files:** `apps/web/__tests__/components/console/traces/ProviderMultiSelect.test.tsx`
**What to do:** Failing test for the behavior: toggling a provider chip emits the resulting array to the change handler; toggling again removes that provider; the currently-selected chips carry `aria-pressed="true"`.
**Acceptance:** Multi-select emits the array of selected providers and announces pressed state.
**Verify:** `pnpm --filter @argus/web test -- ProviderMultiSelect.test.tsx` reports the expected failure.

#### Task 91 (GREEN): Implement `<ProviderMultiSelect />`
**Files:** `apps/web/components/console/traces/ProviderMultiSelect.tsx`
**What to do:** Implement the chip-style multi-select with the four provider values.
**Acceptance:** Task 90 passes.
**Verify:** `pnpm --filter @argus/web test -- ProviderMultiSelect.test.tsx`.

#### Task 92 (RED): `<ModelMultiSelect />` emits the new array on selection change
**Files:** `apps/web/__tests__/components/console/traces/ModelMultiSelect.test.tsx`
**What to do:** Failing test mirroring ProviderMultiSelect's pattern but over the model list passed via prop.
**Acceptance:** Multi-select emits the array of selected models and announces pressed state.
**Verify:** `pnpm --filter @argus/web test -- ModelMultiSelect.test.tsx` reports the expected failure.

#### Task 93 (GREEN): Implement `<ModelMultiSelect />`
**Files:** `apps/web/components/console/traces/ModelMultiSelect.tsx`
**What to do:** Implement the chip-style multi-select over the prop-supplied model list.
**Acceptance:** Task 92 passes.
**Verify:** `pnpm --filter @argus/web test -- ModelMultiSelect.test.tsx`.

#### Task 94 (RED): `<StatusMultiSelect />` emits the new array on selection change
**Files:** `apps/web/__tests__/components/console/traces/StatusMultiSelect.test.tsx`
**What to do:** Failing test mirroring ProviderMultiSelect's pattern for the status enum (`succeeded | failed | canceled | timed_out`).
**Acceptance:** Multi-select emits the array of selected statuses.
**Verify:** `pnpm --filter @argus/web test -- StatusMultiSelect.test.tsx` reports the expected failure.

#### Task 95 (GREEN): Implement `<StatusMultiSelect />`
**Files:** `apps/web/components/console/traces/StatusMultiSelect.tsx`
**What to do:** Implement the chip-style multi-select.
**Acceptance:** Task 94 passes.
**Verify:** `pnpm --filter @argus/web test -- StatusMultiSelect.test.tsx`.

#### Task 96 (RED): `<ConversationMultiSelect />` emits the new array on selection change
**Files:** `apps/web/__tests__/components/console/traces/ConversationMultiSelect.test.tsx`
**What to do:** Failing test mirroring the pattern over the conversation list passed via prop; each item shows the conversation title and is selectable.
**Acceptance:** Multi-select emits the array of selected conversation ids.
**Verify:** `pnpm --filter @argus/web test -- ConversationMultiSelect.test.tsx` reports the expected failure.

#### Task 97 (GREEN): Implement `<ConversationMultiSelect />`
**Files:** `apps/web/components/console/traces/ConversationMultiSelect.tsx`
**What to do:** Implement the chip-style multi-select.
**Acceptance:** Task 96 passes.
**Verify:** `pnpm --filter @argus/web test -- ConversationMultiSelect.test.tsx`.

#### Task 98 (RED): `<FreeTextSearchInput />` debounces input and emits the trimmed query
**Files:** `apps/web/__tests__/components/console/traces/FreeTextSearchInput.test.tsx`
**What to do:** Failing test for the behavior: typing into the input emits the trimmed value to the change handler exactly once at the configured debounce boundary; clearing the input emits an empty string.
**Acceptance:** Search input debounces and emits the trimmed query (empty string when cleared).
**Verify:** `pnpm --filter @argus/web test -- FreeTextSearchInput.test.tsx` reports the expected failure.

#### Task 99 (GREEN): Implement `<FreeTextSearchInput />`
**Files:** `apps/web/components/console/traces/FreeTextSearchInput.tsx`
**What to do:** Implement using `use-debounced-callback`; trim the value before emitting.
**Acceptance:** Task 98 passes.
**Verify:** `pnpm --filter @argus/web test -- FreeTextSearchInput.test.tsx`.

#### Task 100 (RED): `<ClearAllFiltersButton />` click emits the empty-filter event
**Files:** `apps/web/__tests__/components/console/traces/ClearAllFiltersButton.test.tsx`
**What to do:** Failing test for the behavior: clicking the button fires the registered handler exactly once with no argument.
**Acceptance:** Click fires the handler once.
**Verify:** `pnpm --filter @argus/web test -- ClearAllFiltersButton.test.tsx` reports the expected failure.

#### Task 101 (GREEN): Implement `<ClearAllFiltersButton />`
**Files:** `apps/web/components/console/traces/ClearAllFiltersButton.tsx`
**What to do:** Implement the pure button per Task 100.
**Acceptance:** Task 100 passes.
**Verify:** `pnpm --filter @argus/web test -- ClearAllFiltersButton.test.tsx`.

#### Task 102 (RED): `<TracesFilterBar />` composes the five sub-controls and emits the AND-combined filter
**Files:** `apps/web/__tests__/components/console/traces/TracesFilterBar.test.tsx`
**What to do:** Failing test for the behavior: changes to any sub-control produce a single combined filter object emitted to the change handler; the combined object reflects every active sub-filter (AND semantics).
**Acceptance:** Bar emits the AND-combined filter on any sub-change.
**Verify:** `pnpm --filter @argus/web test -- TracesFilterBar.test.tsx` reports the expected failure.

#### Task 103 (GREEN): Implement `<TracesFilterBar />` composition
**Files:** `apps/web/components/console/traces/TracesFilterBar.tsx`
**What to do:** Compose the five sub-controls plus the clear-all button; emit the combined filter on every sub-change.
**Acceptance:** Task 102 passes.
**Verify:** `pnpm --filter @argus/web test -- TracesFilterBar.test.tsx`.

#### Task 104 (RED): `<TracesFilterBar />` clear-all resets to the empty filter object
**Files:** `apps/web/__tests__/components/console/traces/TracesFilterBar.test.tsx`
**What to do:** Failing test for the behavior: after applying filters, clicking clear-all emits the empty filter object.
**Acceptance:** Clear-all emits the empty filter.
**Verify:** `pnpm --filter @argus/web test -- TracesFilterBar.test.tsx` reports the new failure.

#### Task 105 (GREEN): Wire clear-all
**Files:** `apps/web/components/console/traces/TracesFilterBar.tsx`
**What to do:** Reset internal sub-control state and emit the empty filter on clear.
**Acceptance:** Task 104 passes.
**Verify:** `pnpm --filter @argus/web test -- TracesFilterBar.test.tsx`.

#### Task 106 (RED): `<TraceRow />` renders standard cells from a TraceRow DTO and exposes the Jaeger deep link
**Files:** `apps/web/__tests__/components/console/traces/TraceRow.test.tsx`
**What to do:** Failing test for the behavior: every TraceRow field renders in an accessible way; the conversation title is a link to `/console/traces?conversation_id=<id>`; the Jaeger link's href exactly equals `${NEXT_PUBLIC_JAEGER_URL ?? 'http://localhost:16686'}/trace/<trace_id>` and opens in a new tab.
**Acceptance:** Standard cells render; conversation link is correct; Jaeger href matches the exact pattern.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx` reports the expected failure.

#### Task 107 (GREEN): Implement `<TraceRow />` standard render
**Files:** `apps/web/components/console/traces/TraceRow.tsx`
**What to do:** Implement per Task 106. Jaeger URL base from `process.env.NEXT_PUBLIC_JAEGER_URL` with the documented default.
**Acceptance:** Task 106 passes.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx`.

#### Task 108 (RED): `<TraceRow />` renders "(deleted)" suffix for deleted conversation
**Files:** `apps/web/__tests__/components/console/traces/TraceRow.test.tsx`
**What to do:** Failing test for the behavior: when the conversation is flagged deleted, the title appends " (deleted)" and the link remains clickable.
**Acceptance:** Deleted-conversation suffix renders; link remains clickable.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx` reports the new failure.

#### Task 109 (GREEN): Implement deleted-conversation rendering
**Files:** `apps/web/components/console/traces/TraceRow.tsx`
**What to do:** Append the suffix when the deleted flag is set.
**Acceptance:** Task 108 passes.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx`.

#### Task 110 (RED): `<TraceRow />` renders replay badge when kind is `replay`
**Files:** `apps/web/__tests__/components/console/traces/TraceRow.test.tsx`
**What to do:** Failing test for two behaviors: a row with `kind === 'replay'` shows an accessible "Replay" badge; a row with `kind === 'chat'` does not.
**Acceptance:** Replay badge is conditional on kind.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx` reports the new failure.

#### Task 111 (GREEN): Implement replay badge
**Files:** `apps/web/components/console/traces/TraceRow.tsx`
**What to do:** Add the conditional badge.
**Acceptance:** Task 110 passes.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx`.

#### Task 112 (RED): `<TraceRow />` missing token counts render as em-dash
**Files:** `apps/web/__tests__/components/console/traces/TraceRow.test.tsx`
**What to do:** Failing test for the behavior: when both token counts are null, the token cells render as em-dash rather than "0" or empty.
**Acceptance:** Null token counts render as em-dash.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx` reports the new failure.

#### Task 113 (GREEN): Implement null-token display
**Files:** `apps/web/components/console/traces/TraceRow.tsx`
**What to do:** Add the null check.
**Acceptance:** Task 112 passes.
**Verify:** `pnpm --filter @argus/web test -- TraceRow.test.tsx`.

#### Task 114 (RED): `<FailoverChain />` renders one row per attempt with user-message preview above
**Files:** `apps/web/__tests__/components/console/traces/FailoverChain.test.tsx`
**What to do:** Failing test for the behavior: an array of attempts renders one row per attempt in order; a user-message preview prop renders above the list.
**Acceptance:** All attempt rows render in order; preview renders above.
**Verify:** `pnpm --filter @argus/web test -- FailoverChain.test.tsx` reports the expected failure.

#### Task 115 (GREEN): Implement `<FailoverChain />`
**Files:** `apps/web/components/console/traces/FailoverChain.tsx`
**What to do:** Implement per Task 114.
**Acceptance:** Task 114 passes.
**Verify:** `pnpm --filter @argus/web test -- FailoverChain.test.tsx`.

#### Task 116 (RED): `<FailoverChain />` last-row summary reflects final status
**Files:** `apps/web/__tests__/components/console/traces/FailoverChain.test.tsx`
**What to do:** Failing test for two behaviors: when the last attempt succeeded the chain shows a "succeeded after N retries" summary; when the last attempt failed it shows "all attempts failed".
**Acceptance:** Summary line reflects the last-attempt status.
**Verify:** `pnpm --filter @argus/web test -- FailoverChain.test.tsx` reports the new failure.

#### Task 117 (GREEN): Implement summary line
**Files:** `apps/web/components/console/traces/FailoverChain.tsx`
**What to do:** Derive the summary from the last attempt's status.
**Acceptance:** Task 116 passes.
**Verify:** `pnpm --filter @argus/web test -- FailoverChain.test.tsx`.

#### Task 118 (RED): `<TracesTab />` syncs filter state from URL params on mount
**Files:** `apps/web/__tests__/components/console/traces/TracesTab.test.tsx`
**What to do:** Failing test for the behavior: mounting with URL search params that encode a filter rehydrates the filter bar to those values; mounting with no params leaves the bar empty.
**Acceptance:** Filter state mounts in sync with URL params.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx` reports the expected failure.

#### Task 119 (GREEN): Wire URL-to-filter sync in `<TracesTab />`
**Files:** `apps/web/components/console/traces/TracesTab.tsx`
**What to do:** Decode initial filter from the prop-supplied URL params on mount using `traces-filter-encoding.decode`.
**Acceptance:** Task 118 passes.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx`.

#### Task 120 (RED): `<TracesTab />` debounces refetches on filter change
**Files:** `apps/web/__tests__/components/console/traces/TracesTab.test.tsx`
**What to do:** Failing test for the behavior: rapid back-to-back filter changes trigger exactly one refetch at the configured debounce boundary; the refetch carries the latest filter.
**Acceptance:** Filter-change refetch is debounced; only the last value is sent.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx` reports the new failure.

#### Task 121 (GREEN): Wire debounced refetch on filter change
**Files:** `apps/web/components/console/traces/TracesTab.tsx`
**What to do:** Pipe the filter through `use-debounced-callback` before triggering `console-api.fetchTraces`.
**Acceptance:** Task 120 passes.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx`.

#### Task 122 (RED): `<TracesTab />` SSE tick triggers a debounced refetch
**Files:** `apps/web/__tests__/components/console/traces/TracesTab.test.tsx`
**What to do:** Failing test for the behavior: a tick delivered through `useConsoleLive` triggers a refetch via `console-api.fetchTraces`; a burst of ticks coalesces into one refetch at the debounce boundary.
**Acceptance:** SSE tick triggers refetch; burst coalesces.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx` reports the new failure.

#### Task 123 (GREEN): Subscribe `<TracesTab />` to live ticks
**Files:** `apps/web/components/console/traces/TracesTab.tsx`
**What to do:** Subscribe via `useConsoleLive` and route ticks through the same debounced refetch as Task 121.
**Acceptance:** Task 122 passes.
**Verify:** `pnpm --filter @argus/web test -- TracesTab.test.tsx`.

---

### Phase 8: Cost tab components (RED → GREEN pairs)

#### Task 124 (RED): `<Sparkline />` renders an SVG path from a number array
**Files:** `apps/web/__tests__/components/console/cost/Sparkline.test.tsx`
**What to do:** Failing test for the behavior: a non-empty array renders an SVG with a non-empty path; an empty array renders an SVG with no path (or hides).
**Acceptance:** Non-empty input renders a path; empty input renders no path.
**Verify:** `pnpm --filter @argus/web test -- Sparkline.test.tsx` reports the expected failure.

#### Task 125 (GREEN): Implement `<Sparkline />`
**Files:** `apps/web/components/console/cost/Sparkline.tsx`
**What to do:** Implement per Task 124; normalize values to the viewBox height. No external dependency.
**Acceptance:** Task 124 passes.
**Verify:** `pnpm --filter @argus/web test -- Sparkline.test.tsx`.

#### Task 126 (RED): `<Sparkline />` handles flat data without divide-by-zero
**Files:** `apps/web/__tests__/components/console/cost/Sparkline.test.tsx`
**What to do:** Failing test for the behavior: input where all values are equal renders without crashing as a horizontal line.
**Acceptance:** Flat input renders a horizontal line.
**Verify:** `pnpm --filter @argus/web test -- Sparkline.test.tsx`.

#### Task 127 (GREEN): Handle flat-data edge case
**Files:** `apps/web/components/console/cost/Sparkline.tsx`
**What to do:** Guard normalization against zero range.
**Acceptance:** Task 126 passes.
**Verify:** `pnpm --filter @argus/web test -- Sparkline.test.tsx`.

#### Task 128 (RED): `<CostHeader />` renders total spend rounded to display cents and mounts the sparkline child
**Files:** `apps/web/__tests__/components/console/cost/CostHeader.test.tsx`
**What to do:** Failing test for the behavior: a micro-USD total renders as a dollar string rounded once at the end via `toFixed(2)`; the sparkline child is mounted.
**Acceptance:** Total renders rounded; sparkline is present.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx` reports the expected failure.

#### Task 129 (GREEN): Implement `<CostHeader />`
**Files:** `apps/web/components/console/cost/CostHeader.tsx`
**What to do:** Implement per Task 128. Conversion: micro-USD divided by one million, then formatted to two decimal places.
**Acceptance:** Task 128 passes.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx`.

#### Task 130 (RED): `<CostHeader />` shows "< $0.01" for positive sub-cent totals; "$0.00" for true zero
**Files:** `apps/web/__tests__/components/console/cost/CostHeader.test.tsx`
**What to do:** Failing test for two behaviors: positive totals that round below one cent render as "< $0.01"; a true-zero total renders as "$0.00" without the less-than notation.
**Acceptance:** Sub-cent rule and zero rule both render correctly.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx` reports the new failure.

#### Task 131 (GREEN): Implement sub-cent display rule
**Files:** `apps/web/components/console/cost/CostHeader.tsx`
**What to do:** Add the conditional per Task 130.
**Acceptance:** Task 130 passes.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx`.

#### Task 132 (RED): `<CostHeader />` regroup toggle emits the chosen group-by value
**Files:** `apps/web/__tests__/components/console/cost/CostHeader.test.tsx`
**What to do:** Failing test for the behavior: clicking a group-by option emits the corresponding value to the change handler.
**Acceptance:** Group-by toggle emits the chosen value.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx` reports the new failure.

#### Task 133 (GREEN): Wire regroup toggle
**Files:** `apps/web/components/console/cost/CostHeader.tsx`
**What to do:** Add the toggle with the three group-by options.
**Acceptance:** Task 132 passes.
**Verify:** `pnpm --filter @argus/web test -- CostHeader.test.tsx`.

#### Task 134 (RED): `<UnpricedBadge />` shows count and expands to list on click
**Files:** `apps/web/__tests__/components/console/cost/UnpricedBadge.test.tsx`
**What to do:** Failing test for the behavior: the badge shows the count of unpriced models; clicking it expands an accessible popover listing each unpriced model.
**Acceptance:** Count is shown; click expands the list.
**Verify:** `pnpm --filter @argus/web test -- UnpricedBadge.test.tsx` reports the expected failure.

#### Task 135 (GREEN): Implement `<UnpricedBadge />`
**Files:** `apps/web/components/console/cost/UnpricedBadge.tsx`
**What to do:** Implement per Task 134; render nothing when the list is empty.
**Acceptance:** Task 134 passes.
**Verify:** `pnpm --filter @argus/web test -- UnpricedBadge.test.tsx`.

#### Task 136 (RED): `<CostTable />` renders grouped rows with prompt/completion/total columns
**Files:** `apps/web/__tests__/components/console/cost/CostTable.test.tsx`
**What to do:** Failing test for the behavior: two cost groups render as two rows, each showing prompt/completion/total micro-USD values rounded to display cents plus the row-count.
**Acceptance:** All grouped rows render with the four expected columns.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx` reports the expected failure.

#### Task 137 (GREEN): Implement `<CostTable />` standard render
**Files:** `apps/web/components/console/cost/CostTable.tsx`
**What to do:** Implement per Task 136; reuse the rounding rule from `<CostHeader />`.
**Acceptance:** Task 136 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx`.

#### Task 138 (RED): `<CostTable />` renders the unpriced badge for groups with unpriced models
**Files:** `apps/web/__tests__/components/console/cost/CostTable.test.tsx`
**What to do:** Failing test for the behavior: a row whose group carries non-empty unpriced models mounts the unpriced badge with that list.
**Acceptance:** Unpriced badge mounts conditionally.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx` reports the new failure.

#### Task 139 (GREEN): Mount the unpriced badge conditionally
**Files:** `apps/web/components/console/cost/CostTable.tsx`
**What to do:** Render the badge when the unpriced model list is non-empty.
**Acceptance:** Task 138 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx`.

#### Task 140 (RED): `<CostTable />` mock-provider rows are visually distinct with a screen-reader annotation
**Files:** `apps/web/__tests__/components/console/cost/CostTable.test.tsx`
**What to do:** Failing test for the behavior: a group flagged as mock renders with a "(mock provider)" annotation accessible to screen readers and carries a distinguishing data attribute.
**Acceptance:** Mock rows have the annotation and the data attribute.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx` reports the new failure.

#### Task 141 (GREEN): Mark mock rows
**Files:** `apps/web/components/console/cost/CostTable.tsx`
**What to do:** Add the visual treatment and accessible annotation per Task 140.
**Acceptance:** Task 140 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx`.

#### Task 142 (RED): `<CostTable />` row click invokes the drilldown handler with the group
**Files:** `apps/web/__tests__/components/console/cost/CostTable.test.tsx`
**What to do:** Failing test for the behavior: clicking a row fires the drilldown handler with that row's group object.
**Acceptance:** Row click fires drilldown with the group.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx` reports the new failure.

#### Task 143 (GREEN): Wire drilldown
**Files:** `apps/web/components/console/cost/CostTable.tsx`
**What to do:** Add the click handler per Task 142.
**Acceptance:** Task 142 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTable.test.tsx`.

#### Task 144 (RED): `<CostTab />` syncs time window from URL params on mount
**Files:** `apps/web/__tests__/components/console/cost/CostTab.test.tsx`
**What to do:** Failing test for the behavior: mounting with a URL window param rehydrates the time-window toggle to that value; mounting with no param defaults to `24h`.
**Acceptance:** Time window mounts in sync with URL.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx` reports the expected failure.

#### Task 145 (GREEN): Wire URL-to-window sync in `<CostTab />`
**Files:** `apps/web/components/console/cost/CostTab.tsx`
**What to do:** Read the initial window from prop-supplied URL params.
**Acceptance:** Task 144 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx`.

#### Task 146 (RED): `<CostTab />` group-by change triggers refetch
**Files:** `apps/web/__tests__/components/console/cost/CostTab.test.tsx`
**What to do:** Failing test for the behavior: changing the group-by toggle issues exactly one refetch via `console-api.fetchCost` with the new group-by value.
**Acceptance:** Group-by change triggers exactly one refetch with the new value.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx` reports the new failure.

#### Task 147 (GREEN): Wire group-by refetch in `<CostTab />`
**Files:** `apps/web/components/console/cost/CostTab.tsx`
**What to do:** Trigger refetch on group-by change.
**Acceptance:** Task 146 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx`.

#### Task 148 (RED): `<CostTab />` derives the sparkline series from the latest fetched response
**Files:** `apps/web/__tests__/components/console/cost/CostTab.test.tsx`
**What to do:** Failing test for the behavior: after a fetch resolves, the sparkline mounted inside `<CostHeader />` receives the sparkline series from the response.
**Acceptance:** Sparkline series matches the fetched response.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx` reports the new failure.

#### Task 149 (GREEN): Pipe sparkline data into `<CostHeader />`
**Files:** `apps/web/components/console/cost/CostTab.tsx`
**What to do:** Pass the fetched sparkline series as a prop to `<CostHeader />`.
**Acceptance:** Task 148 passes.
**Verify:** `pnpm --filter @argus/web test -- CostTab.test.tsx`.

---

### Phase 9: Replay tab components (RED → GREEN pairs)

#### Task 150 (RED): `<ReplayPicker />` renders one entry per candidate with status badge
**Files:** `apps/web/__tests__/components/console/replay/ReplayPicker.test.tsx`
**What to do:** Failing test for the behavior: four candidates with different statuses render four entries each carrying an accessible status label; the canceled entry additionally shows a "partial input only" warning.
**Acceptance:** All candidates render; status labels are accessible; canceled entries carry the warning.
**Verify:** `pnpm --filter @argus/web test -- ReplayPicker.test.tsx` reports the expected failure.

#### Task 151 (GREEN): Implement `<ReplayPicker />`
**Files:** `apps/web/components/console/replay/ReplayPicker.tsx`
**What to do:** Implement per Task 150; emit a selection event on entry click.
**Acceptance:** Task 150 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayPicker.test.tsx`.

#### Task 152 (RED): `<ReplayPicker />` filters candidates by the passed window prop
**Files:** `apps/web/__tests__/components/console/replay/ReplayPicker.test.tsx`
**What to do:** Failing test for the behavior: a window prop excludes candidates older than the window cutoff; window `all` includes everything.
**Acceptance:** Window prop filters the candidate list.
**Verify:** `pnpm --filter @argus/web test -- ReplayPicker.test.tsx` reports the new failure.

#### Task 153 (GREEN): Implement window filtering
**Files:** `apps/web/components/console/replay/ReplayPicker.tsx`
**What to do:** Drop candidates older than the window cutoff before render; the `all` window skips the filter.
**Acceptance:** Task 152 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayPicker.test.tsx`.

#### Task 154 (RED): `<ProviderModelPicker />` disables unavailable providers with tooltip + "switch to Mock" CTA
**Files:** `apps/web/__tests__/components/console/replay/ProviderModelPicker.test.tsx`
**What to do:** Failing test for the behavior: unavailable providers from the availability prop render as disabled options with a tooltip mentioning "key not configured" and an inline "switch to Mock" CTA next to each disabled option.
**Acceptance:** Unavailable providers are disabled with the tooltip and CTA.
**Verify:** `pnpm --filter @argus/web test -- ProviderModelPicker.test.tsx` reports the expected failure.

#### Task 155 (GREEN): Implement `<ProviderModelPicker />` availability gating
**Files:** `apps/web/components/console/replay/ProviderModelPicker.tsx`
**What to do:** Implement per Task 154 with `aria-disabled` and the CTA per disabled option.
**Acceptance:** Task 154 passes.
**Verify:** `pnpm --filter @argus/web test -- ProviderModelPicker.test.tsx`.

#### Task 156 (RED): `<ProviderModelPicker />` model dropdown updates options on provider change using the availability catalog
**Files:** `apps/web/__tests__/components/console/replay/ProviderModelPicker.test.tsx`
**What to do:** Failing test for the behavior: the availability prop carries a per-provider model list (sourced from `ProviderAvailabilityResponseSchema`); switching the provider in the picker re-renders the model dropdown with that provider's models from the catalog. The frontend never hardcodes a model list.
**Acceptance:** Model dropdown is keyed off the availability catalog and updates on provider switch.
**Verify:** `pnpm --filter @argus/web test -- ProviderModelPicker.test.tsx` reports the new failure.

#### Task 157 (GREEN): Implement model dropdown driven by availability catalog
**Files:** `apps/web/components/console/replay/ProviderModelPicker.tsx`
**What to do:** Derive the model options from the availability prop keyed on the currently selected provider; emit a combined provider+model change event.
**Acceptance:** Task 156 passes.
**Verify:** `pnpm --filter @argus/web test -- ProviderModelPicker.test.tsx`.

#### Task 158 (RED): `<ReplayErrorMessage />` renders distinct copy per failure kind
**Files:** `apps/web/__tests__/components/console/replay/ReplayErrorMessage.test.tsx`
**What to do:** Failing test for three behaviors: `original_canceled` shows the no-output-to-compare copy; `replay_failed` shows a message embedding the cause; `both_failed` shows a generic both-failed message.
**Acceptance:** Each failure kind renders its distinct copy.
**Verify:** `pnpm --filter @argus/web test -- ReplayErrorMessage.test.tsx` reports the expected failure.

#### Task 159 (GREEN): Implement `<ReplayErrorMessage />`
**Files:** `apps/web/components/console/replay/ReplayErrorMessage.tsx`
**What to do:** Implement per Task 158 using a kind-keyed copy table.
**Acceptance:** Task 158 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayErrorMessage.test.tsx`.

#### Task 160 (RED): `<DiffRenderer />` renders the precomputed diff payload as highlighted spans
**Files:** `apps/web/__tests__/components/console/replay/DiffRenderer.test.tsx`
**What to do:** Failing test for the behavior: a diff payload made of added/removed/unchanged segments renders as a sequence of text spans, with added segments carrying an "added" indicator on the wrapping element.
**Acceptance:** Diff payload renders as text spans with added segments distinguishable via attribute.
**Verify:** `pnpm --filter @argus/web test -- DiffRenderer.test.tsx` reports the expected failure.

#### Task 161 (GREEN): Implement `<DiffRenderer />`
**Files:** `apps/web/components/console/replay/DiffRenderer.tsx`
**What to do:** Map each diff entry to a span carrying the appropriate data attribute and accessible label.
**Acceptance:** Task 160 passes.
**Verify:** `pnpm --filter @argus/web test -- DiffRenderer.test.tsx`.

#### Task 162 (RED): `<DiffRenderer />` handles `removed` segments and renders nothing for empty payload
**Files:** `apps/web/__tests__/components/console/replay/DiffRenderer.test.tsx`
**What to do:** Failing test for two behaviors: removed segments are rendered with a "removed" indicator and remain visible; an empty payload renders an empty container without crashing.
**Acceptance:** Removed segments render with the removed indicator; empty payload is a safe no-op.
**Verify:** `pnpm --filter @argus/web test -- DiffRenderer.test.tsx` reports the new failure.

#### Task 163 (GREEN): Implement removed + empty edge cases
**Files:** `apps/web/components/console/replay/DiffRenderer.tsx`
**What to do:** Add the removed branch and the empty guard.
**Acceptance:** Task 162 passes.
**Verify:** `pnpm --filter @argus/web test -- DiffRenderer.test.tsx`.

#### Task 164 (RED): `<ReplayTab />` routes between candidate list and detail view based on selected source
**Files:** `apps/web/__tests__/components/console/replay/ReplayTab.test.tsx`
**What to do:** Failing test for the behavior: with no source selected, the picker is rendered; with a source selected, the detail view is rendered; clicking a picker entry transitions to detail.
**Acceptance:** Candidate-vs-detail routing toggles based on selected source.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx` reports the expected failure.

#### Task 165 (GREEN): Wire candidate-vs-detail routing
**Files:** `apps/web/components/console/replay/ReplayTab.tsx`
**What to do:** Internal state holds the selected source; rendering branches on its presence.
**Acceptance:** Task 164 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx`.

#### Task 166 (RED): `<ReplayTab />` replay-run lifecycle covers idle → running → success
**Files:** `apps/web/__tests__/components/console/replay/ReplayTab.test.tsx`
**What to do:** Failing test for the behavior: invoking the run-replay action transitions the tab from `idle` to `running`; resolving the mocked `console-api.runReplay` transitions to `success`; the second pane mounts with the resulting output and diff.
**Acceptance:** Run lifecycle covers idle → running → success and mounts the second pane on success.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx` reports the new failure.

#### Task 167 (GREEN): Implement run lifecycle (idle → running → success)
**Files:** `apps/web/components/console/replay/ReplayTab.tsx`
**What to do:** Drive a small state machine off `console-api.runReplay`; on success expose the replay payload to `<ReplayDetail />`.
**Acceptance:** Task 166 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx`.

#### Task 168 (RED): `<ReplayTab />` replay-run failure transitions to `failed` and mounts the error message
**Files:** `apps/web/__tests__/components/console/replay/ReplayTab.test.tsx`
**What to do:** Failing test for the behavior: when the mocked run rejects, the tab transitions to `failed` and `<ReplayErrorMessage />` is mounted with the appropriate failure kind.
**Acceptance:** Failure transitions to `failed` and mounts the error message.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx` reports the new failure.

#### Task 169 (GREEN): Wire failure path
**Files:** `apps/web/components/console/replay/ReplayTab.tsx`
**What to do:** Catch the run rejection, map to the right failure kind, render `<ReplayErrorMessage />`.
**Acceptance:** Task 168 passes.
**Verify:** `pnpm --filter @argus/web test -- ReplayTab.test.tsx`.

---

### Phase 10: Page scaffolding (non-TDD — UI composition + routing glue)

#### Task 170: [non-TDD — page scaffolding] Create `/console` layout shell
**Files:** `apps/web/app/console/layout.tsx`
**What to do:** Create the async server component layout. Await `server-session()`; if null, redirect to `/login`. Render `<ConsoleHeader />` (with `<LiveBadge />`, `<ClearButton />`, `<SampleDataButton />`, tab nav) wrapped in `<ConsoleLiveProvider>` and `{children}`. Reuse Phase A's `server-session` + `redirect` patterns.
**Acceptance:** Build succeeds; navigating to `/console` while logged out redirects to `/login`.
**Verify:** `pnpm --filter @argus/web build`; manual logged-out navigation.

#### Task 171: [non-TDD — routing glue] Create `/console/page.tsx` redirect to `/console/traces`
**Files:** `apps/web/app/console/page.tsx`
**What to do:** Server component that redirects to `/console/traces` so the default tab is unambiguous.
**Acceptance:** Navigating to `/console` lands on `/console/traces`.
**Verify:** Manual click-through.

#### Task 172: [non-TDD — page composition] Create `/console/traces/page.tsx`
**Files:** `apps/web/app/console/traces/page.tsx`
**What to do:** Async server component. Await `searchParams`, decode filters via `traces-filter-encoding.decode`, call `console-api.fetchTraces` with window + filters + cursor, pass to `<TracesTab>`. Wrap in a Suspense boundary so the tab can stream.
**Acceptance:** Build succeeds; visiting `/console/traces` renders without runtime errors.
**Verify:** `pnpm --filter @argus/web build`; manual click-through.

#### Task 173: [non-TDD — page composition] Create `/console/cost/page.tsx`
**Files:** `apps/web/app/console/cost/page.tsx`
**What to do:** Async server component. Await `searchParams`, read window + groupBy + includeSample + includeReplay, call `console-api.fetchCost`, pass to `<CostTab>`.
**Acceptance:** Build succeeds; visiting `/console/cost` renders without runtime errors.
**Verify:** `pnpm --filter @argus/web build`; manual click-through.

#### Task 174: [non-TDD — page composition] Create `/console/replay/page.tsx`
**Files:** `apps/web/app/console/replay/page.tsx`
**What to do:** Async server component. Await `searchParams`, read optional `source` inference id and window; if `source` is present call `console-api.fetchReplayDetail`, else `fetchReplayCandidates`; pass to `<ReplayTab>`.
**Acceptance:** Build succeeds; visiting `/console/replay` renders without runtime errors.
**Verify:** `pnpm --filter @argus/web build`; manual click-through.

#### Task 175: [non-TDD — UI orchestration] Compose `<TracesTab>` shell render
**Files:** `apps/web/components/console/traces/TracesTab.tsx`
**What to do:** Compose the tab JSX: `<ThroughputStrip />` + `<TracesFilterBar />` + a filter-bound feed of `<TraceRow />` + `<EmptyState scope="traces" />` when the row list is empty. Row expansion mounts `<FailoverChain />`. Note that filter sync, debounced refetch, and live-tick subscription are TDD'd in Tasks 118-123; this task is the JSX composition only.
**Acceptance:** Manual click-through: with sample data, rows render; clicking a row expands the chain; the empty state shows when there are no rows.
**Verify:** `pnpm --filter @argus/web build` exits 0; manual click-through.

#### Task 176: [non-TDD — UI orchestration] Compose `<CostTab>` shell render
**Files:** `apps/web/components/console/cost/CostTab.tsx`
**What to do:** Compose `<CostHeader>` + `<CostTable>` + `<EmptyState scope="cost" />`. Row drilldown navigates to `/console/traces?conversation_id=<id>`. Window sync, group-by refetch, and sparkline derivation are TDD'd in Tasks 144-149; this task is the JSX composition only.
**Acceptance:** Manual click-through: changing window/grouping updates the table; clicking a row navigates to filtered Traces.
**Verify:** `pnpm --filter @argus/web build` exits 0; manual click-through.

#### Task 177: [non-TDD — UI orchestration] Compose `<ReplayTab>` shell render
**Files:** `apps/web/components/console/replay/ReplayTab.tsx`, `apps/web/components/console/replay/ReplayDetail.tsx`, `apps/web/components/console/replay/SideBySidePane.tsx`
**What to do:** Compose `<ReplayPicker>` (no source selected) vs `<ReplayDetail>` (source selected): original metadata + `<ProviderModelPicker>` + `<RunReplayButton>` + `<ResetToOriginalButton>` + `<SideBySidePane>` with `<DiffToggle>` and `<PaneExpandControl>` per pane. Routing and run-lifecycle state are TDD'd in Tasks 164-169; this task is the JSX composition only.
**Acceptance:** Manual click-through: pick a candidate, change provider/model, click Run, see side-by-side; toggle diff highlighting; expand a pane; reset to original restores defaults.
**Verify:** `pnpm --filter @argus/web build` exits 0; manual click-through.

#### Task 178: [non-TDD — UI scaffolding] Compose `<ConsoleHeader>`
**Files:** `apps/web/components/console/ConsoleHeader.tsx`, `apps/web/components/console/ClearButton.tsx`
**What to do:** Header composes the tab nav (three links using `Link` + `usePathname` for active highlight), `<LiveBadge />`, `<SampleDataButton />`, and `<ClearButton />` (mounts `<ClearModal />` on click). Active tab carries `aria-current="page"`.
**Acceptance:** Manual click-through: tabs navigate; active tab highlighted; Clear button opens the modal; Generate-Samples button works.
**Verify:** `pnpm --filter @argus/web build` exits 0; manual click-through.

---

## Phase B Smoke Test Checklist (post-build QA — not a builder task)

> This appendix is an operational QA checklist, not an implementation task. Capture results in the PR description via `pr-writer`.

With the compose stack running (`docker compose up`), Phase A migrations applied, Phase B migrations applied, and at least one real-provider key (or `MOCK_PROVIDER=true`), reproduce these steps locally and confirm each completes without console errors or DOM warnings:

1. Sign up + land on `/chat`.
2. Send a turn → click `/console` → on Traces, the new row appears within 5s.
3. Click "Generate sample inferences" → all three tabs populate within 5s.
4. Switch to Cost → group by provider; toggle window 24h → 7d → all; sparkline updates.
5. Switch to Replay → pick a candidate → change to a different provider/model → run replay → side-by-side appears; toggle diff highlighting.
6. Back on Traces, expand a failed-after-retries row (force one by stopping a provider mid-test) → see the failover chain.
7. Open Clear modal → see breakdown counts → type CLEAR → submit → tabs return to empty.
8. Kill the api container for >30s → LiveBadge transitions through behind → error; restart api → returns to live.
9. Logout → land on `/login`; re-login as same user → sample data is gone (per PRD lifetime rule).

Acceptance: reproducing the nine steps locally produces the expected UI state at each step. Screenshots optional.

---

## Quality Gates
- typecheck: `pnpm --filter @argus/web typecheck`
- lint: `pnpm --filter @argus/web lint`
- test: `pnpm --filter @argus/web test`
- build: `pnpm --filter @argus/web build`
- contracts test: `pnpm --filter @argus/contracts test`
- root-level (catches workspace drift): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## Dependencies

- **`packages/contracts`** — Tasks 1A-1B in this LLD verify (not author) the SSE + console DTO schemas the frontend consumes. Backend-api LLD owns the authoring of `live-events.ts`, `console.ts`, and the OTel attribute extensions. Both LLDs MUST agree on the export names listed in the Coordinated contract exports section. Any name change must be coordinated.
- **`apps/api`** — must expose `/api/console/live` (SSE), `/api/console/live/badge`, `/api/console/traces`, `/api/console/cost`, `/api/console/replay/candidates`, `/api/console/replay/:id`, `POST /api/console/replay`, `POST /api/console/sample`, `GET /api/console/clear/preview`, `POST /api/console/clear`, `GET /api/providers/availability`. Owned by the backend-api Phase B LLD; needed live for the smoke checklist.
- **`apps/workers`** — must publish to the `live-events` Kafka topic after each successful row commit (per HLD D3); without this, SSE ticks never fire and smoke step 2 fails.
- **`packages/db`** — migration `0002_phase_b_kind_enum` must be applied before the smoke checklist runs.

## Deferred to chat-context-and-ux-polish bundle

The following frontend work was originally scoped into this LLD but is now deferred to the parallel `docs/oh/chat-context-and-ux-polish/` planning bundle in argus. That bundle is in flight and will land its own LLD covering these items as a separate chunk, sequenced after the parallel chat UX polish work completes:

- **`<ProviderSelector />`** component (`apps/web/components/chat/ProviderSelector.tsx`) — the four-option Auto/OpenAI/Anthropic/Gemini control with Mock-fallback visibility rule and availability-driven disabled states.
- **`<KeylessAutoBanner />`** component (`apps/web/components/chat/KeylessAutoBanner.tsx`) — the banner shown above the composer when selection is `auto` and OpenAI is unavailable.
- **`provider-selection-storage.ts`** helpers (`apps/web/lib/provider-selection-storage.ts`) — localStorage round-trip for the persisted chat-surface provider selection.
- **`<ChatSurface>` / `<ChatTopbar>` / `<MessageComposer>` integration** — mounting the selector + banner, fetching `GET /api/providers/availability` on chat mount, extending the WS `send` frame with the chosen `provider` field, and restoring the persisted selection on mount.
- All test pairs that backed the above (`ProviderSelector.test.tsx`, `KeylessAutoBanner.test.tsx`, `provider-selection-storage.test.ts`).

Why deferred: the parallel `chat-context-and-ux-polish` bundle is the active planning track for chat surface UX in argus, and avoiding double-ownership prevents merge conflicts and duplicated test plans. The Auto routing classifier on the server side (backend-api Phase B LLD) is unaffected — `/chat` retains Phase A's behavior (no client-side provider selection UI) until the deferred chunk lands. The `ProviderAvailabilityResponseSchema` and `ProviderSelectionSchema` contracts still belong in `packages/contracts` because this LLD's `<ProviderModelPicker />` (replay tab) and `console-api.fetchProviderAvailability` both consume them.

## Open Questions (LLD-level)

- **Server-side vs client-side diff.** HLD D4 prefers server-side via `jsdiff.diffWords` and flags client-side as defensible. This LLD assumes server-side: `<DiffRenderer />` is a pure renderer and the payload arrives precomputed via `ReplayRunResponseSchema`. If backend-api LLD decides to ship raw outputs only and compute client-side, `<DiffRenderer />` grows a `jsdiff` import — flagged for coordination.
- **Cross-origin SSE auth.** Assumed same-origin so the session cookie attaches. If the SSE host differs from the Next host, `sse-client.ts` needs an explicit auth scheme — not currently planned.
- **Live badge cadence.** Default 1s polling chosen as the LLD assumption; PRD says "roughly 5 seconds" for the live bar but the badge itself can poll faster. Backend may prefer a lower cadence to reduce DB load; flagged for coordination.
- **Filter URL state.** Traces filters live in the URL (decoded server-side in Task 172) so deep links work. Worker decides whether to also persist the active filter in local storage for cross-session continuity — not currently planned.
- **Sample-data session lifetime detection.** PRD says logout = sample gone, re-login = no visibility. This LLD assumes the backend enforces the visibility rule via the session's `current_sample_workspace_id` pointer (per HLD D5), so the frontend does not need any client-side bookkeeping. If backend prefers the frontend to flag stale sample data, Task 175's empty-state branch grows a "stale sample workspace" path.

## Reviewer Concerns

Codex v2 review (6/10, up from 4/10) surfaced these unresolved items after 2 review iterations per /oh discipline. Builder absorbs during execution. Items that referenced now-deferred chat surface tasks have been removed.

- **3 tasks still mildly oversized** (1A schema round-trip, 177 Replay composition, 178 Console header) — split during execution by behavior/component.
- **`console-api.ts` server/client module-boundary risk** — Next.js cannot safely have a single module that both imports `server-only` and exports browser-callable helpers. Split into `console-api.server.ts` and `console-api.client.ts`; optionally a barrel that does not import `server-only`. Decide at Task 49.
- **Underspecified contract DTOs** — `TraceRowSchema` fields, `ReplayRunResponseSchema` diff payload shape, `ClearPreviewResponseSchema` per-kind breakdown not enumerated here. Depend on contracts being authored. Order: contracts first, then frontend Phase 1A.
- **Missing tests for active-tab `aria-current` and `/console` auth redirect** — currently manual-only. Add one component test for ConsoleHeader active-tab and one server-component redirect test for `/console` middleware.
- **`useLiveBadge` threshold configurability** — defaults (5s/30s) baked in but not tested for tunability.
- **URL update on filter change** — current plan tests URL decode on mount but not URL encode/push on filter change. Deep links break without this.
