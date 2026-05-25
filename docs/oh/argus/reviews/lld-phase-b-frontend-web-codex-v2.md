## 0. Format Violations

- **Forbidden file reference in the plan**
  > `framing: see ~/.claude/skills/oh/prompts/builder-addendum.md`

  The user explicitly says not to read or execute anything under `~/.claude/`. Delete this reference or inline the relevant non-code framing text in the LLD.

- **Task 1B says `Files: none` but requires adding a test**
  > `**Files:** none (coordination task — verify backend-api LLD's contract-authoring tasks have landed)`  
  > `Also add an export-presence sanity test that imports each named export...`

  This is internally inconsistent. Add the actual test file path, probably `packages/contracts/__tests__/exports.test.ts` or fold it into one of the existing contract test files.

- **Tasks too large for the stated bite-sized rule**
  > `Task 1A ... Write one happy-path round-trip test per schema named...`

  This is many schemas plus config setup. Split into smaller RED tasks: live events, trace/cost schemas, replay schemas, misc console schemas, export presence.

  > `Task 190 ... Compose <ReplayPicker> ... <ReplayDetail> ... <ProviderModelPicker> ... <RunReplayButton> ... <ResetToOriginalButton> ... <SideBySidePane> ... <DiffToggle> and <PaneExpandControl>`

  This is not a 5-minute task. Split into detail layout, run controls, side-by-side pane, diff toggle, pane expansion.

  > `Task 191 ... Header composes the tab nav ... <LiveBadge />, <SampleDataButton />, and <ClearButton />`

  Also too broad. Split `ConsoleHeader` nav from `ClearButton` modal trigger wiring.

- **Type-like schema definitions in the plan**
  > `Shape: { providers: Record<'openai' | 'anthropic' | 'gemini' | 'mock', { available: boolean, models: string[] }> }`  
  > `Shape: { lagMs: number }`

  These are close to inline type definitions. Keep prose-level shape descriptions or reference the contract schema names. Exact types belong in contract files.

## 1. Tasks That Are Too Vague To Execute

- > `Each test parses a representative valid payload and rejects a payload missing one required field.`

  For 18+ schemas, “representative” is underspecified. The builder needs required fields for each DTO or a pointer to authoritative backend contract fixtures.

- > `TraceRowSchema`

  The LLD never defines the actual `TraceRow` fields, but later components require provider, model, status, latency, token counts, conversation title/id/deleted flag, trace id, kind, failover chain, timestamp. The builder will invent fields unless contract ownership lands first.

- > `ReplayRunResponseSchema (the response carries the new inference row id + the precomputed diff payload)`

  The diff payload shape is never specified. Later `DiffRenderer` tests mention added/removed/unchanged segments, but no field names or nesting are defined.

- > `ProviderModelPicker ... "switch to Mock" CTA`

  It does not say what the CTA does: immediately changes provider to mock, emits a change event, selects the first mock model, or only focuses the mock option.

- > `Task 169 ... map to the right failure kind`

  The mapping from thrown errors to `original_canceled | replay_failed | both_failed` is not defined. The builder cannot infer this reliably from a generic rejected promise.

- > `ClearPreviewResponseSchema (per-kind breakdown counts)`

  “per-kind” is ambiguous. Is this keyed by `chat/classifier/replay/sample/...`, by inference status, or by table/resource kind?

## 2. Missing Acceptance Criteria

Most tasks include acceptance criteria, but several are not observable enough:

- > `Task 49 ... the client function lives in the same module but does not transitively pull server-only into client bundles`

  Acceptance says tests pass, but the LLD does not require a build/import test from a client component or a module-boundary test that would actually catch this.

- > `Task 181 ... observable in Traces`

  This depends on backend and worker behavior. Add a local/unit acceptance too: `MessageComposer` sends a WS frame containing the selected provider.

- > `Task 183 ... navigating to /console while logged out redirects to /login`

  Also needs logged-in acceptance: authenticated users see the shell and children render.

## 3. Test Gaps

- No test for `ConsoleHeader` active tab behavior even though acceptance requires:
  > `Active tab carries aria-current="page"`

- No unit/integration test for `/console` auth redirect. It is manual-only, but this is important routing behavior.

- No test that `ConsoleLiveProvider` creates only one shared SSE connection across all tabs. The LLD states:
  > `so all three tabs share one stream`

- No test that `SseClient` uses `defaultSseUrl()` when no URL is supplied, if that is intended. The constructor behavior only tests explicit URL.

- No test for `Last-Event-ID` being intentionally unused. Since the LLD calls this out as a maintenance hazard, test or document acceptance should ensure no replay cursor logic is added.

- `useLiveBadge` tests cover polling and errors but not threshold configurability:
  > `thresholds ... 5s default ... 30s default`

- No test for `ProviderSelector` persistence integration in `ChatTopbar`/`ChatSurface`; Phase 11 is manual-only despite state persistence being easy to regress.

- No test that Mock is not silently substituted into the WS frame:
  > `Mock is never silently substituted per PRD`

- No test for URL updates when Traces filters change. The plan tests decoding URL params on mount, but not whether filter changes update the URL for deep links.

## 4. File-Path Errors

- > `framing: see ~/.claude/skills/oh/prompts/builder-addendum.md`

  Forbidden path for this review and a bad handoff reference.

- > `Task 49 ... split into two sub-modules if needed, e.g. console-api.server.ts + console-api.client.ts`  
  > `**Files:** apps/web/lib/console-api.ts`

  File list is incomplete if the intended safe implementation requires split modules. Add possible files explicitly.

- > `apps/web/lib/console-api.ts — Server-side helpers ... import server-only ... Browser-side helpers ... use auth-fetch`

  This is likely a Next.js module-boundary problem. A single module importing `server-only` cannot safely export browser-callable helpers.

- > `Task 139` is referenced in scaffold facts as chat provider injection:
  > `Phase A Chat surface files referenced by Task 139`

  But actual Task 139 is:
  > `<CostTable /> Mount the unpriced badge conditionally`

  This numbering drift will confuse the builder. The chat provider injection task is Task 181.

## 5. Hand-Off Risk

- The contract/frontend dependency is fragile. The LLD says frontend must not invent stubs, but Task 1A asks frontend to create tests against schemas that do not exist yet. That is fine as RED, but later frontend tasks depend on exact DTO fields that are not fully specified.

- The `console-api` design risks client bundle failures because server and client fetchers are described in one module. Require `console-api.server.ts` and `console-api.client.ts` up front, then optionally a barrel that does not import `server-only`.

- The live system is split between SSE ticks and polling badge lag, but it is not clear how retries work from the `LiveBadge` Retry button. `useLiveBadge` must expose a refetch API, but its task does not mention returning one until the component task.

- Several “pure render” components actually need client behavior: expandable rows, popovers, dropdowns, tooltips, pane expansion. The builder may incorrectly omit `'use client'` or add state in parents inconsistently.

- The LLD over-specifies many tiny component tests but under-specifies shared DTO fixtures. Without canonical fixtures, tests and implementation may drift from backend schemas.

- Manual-only Phase 11 and Phase 12 cover important integration behavior. That may be acceptable late in the project, but the builder will have little automated protection around the actual `/chat` and `/console` wiring.

## 6. Quality Score

**6/10**

The plan is comprehensive and mostly structured as RED/GREEN pairs, but it is not ready to hand off cleanly. Main blockers are the forbidden `~/.claude` reference, oversized tasks, inconsistent file lists, server/client module-boundary risk, and underspecified contract DTO shapes that the frontend tasks depend on.
