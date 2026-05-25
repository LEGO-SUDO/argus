## 0. Format Violations

Hard rejection: the LLD contains detailed test assertions throughout. Example:

> “asserts the stub was called once with that URL and the `withCredentials` option.”

> “dispatches a synthetic `message` event whose `data` is a JSON-serialised valid `LiveEvent` tick, and asserts `onEvent` was called…”

> “advance the timer 199ms — assert spy not called; advance 1ms more — assert spy called exactly once.”

These should be reduced to behavioral intent. The test files should hold assertion mechanics.

Function-signature-style lines are present:

> “Construction signature: `new SseClient(url, { withCredentials })`.”

> “Implement `encode(filter): URLSearchParams` and `decode(searchParams): filter`…”

Replace with prose I/O descriptions.

Multiple tasks are not bite-sized and will exceed 5 minutes:

> “Implement provider/model/status/conversation multi-selects plus a debounced search box…”

Split `TracesFilterBar` into provider/status/search/clear tasks.

> “Client component that renders `<ReplayPicker>` when no source is selected, otherwise `<ReplayDetail>`…”

Split Task 137 into picker routing, detail shell, run replay, diff toggle, pane expansion, reset behavior.

> “Add the provider-selector control to the chat surface… fetch availability… pass the selection into each WS `send` frame… mount banner… Persist the selection…”

Split Task 139 into discovery, availability fetch, localStorage persistence, WS payload change, banner mount.

> “End-to-end happy-path smoke… reproduce these steps…”

Task 140 is an operational checklist, not a builder task. Keep it as final QA, but do not treat as a bite-sized implementation task.

## 1. Tasks That Are Too Vague To Execute

> “Same scaffold as Phase A… React 18.3.x… Jest + RTL + jsdom configured under `apps/web/`.”

This is false against the current repo. `apps/web/package.json` has React 19, no `test` script, no Jest config, and no RTL dependency. Builder needs an explicit prerequisite task to add/configure web tests, or the whole RED/GREEN plan is non-runnable.

> “Phase A surfaces (`/login`, `/signup`, `/chat`, `/chat/[conversationId]`, the WS streaming reducer) are unchanged…”

Those paths do not exist in the visible repo. The current app only has `apps/web/app/page.tsx`, root layout, and brand components. The LLD assumes a prior implementation that is not present.

> “reuses Phase A `server-session`”

No file path is given, and no such helper appears in the current `apps/web` tree. Builder needs exact import path or a prerequisite task.

> “using `server-api-fetch`” / “using `client-api-fetch`”

No paths are provided and these helpers are not present in the visible repo. This blocks `console-api.ts`.

> “mirrors `ws-client.ts` conventions exactly.”

`apps/web/lib/ws-client.ts` is not present. This instruction is unusable unless Phase A lands first.

> “fetchProviderAvailability() GETs `/api/providers/availability` and parses an availability record”

The availability response schema is not specified in contracts. Builder needs exact shape, e.g. provider booleans plus model catalog or only key availability.

> “TraceRow… Jaeger link points to a URL containing `t1`.”

The Jaeger URL format is unspecified. “Contains trace id” is too weak for implementation compatibility.

> “ProviderModelPicker… model catalog mapping `provider -> models[]`”

No source of this catalog is specified: hardcoded frontend constants, availability endpoint, contracts, or backend response.

## 2. Missing Acceptance Criteria

Most tasks have acceptance and verify commands, but several acceptances are not actually observable enough:

> Task 1B: “All Task 1A tests pass; `@argus/contracts` exports every name…”

Good high-level acceptance, but it does not say how export presence is verified beyond tests. Add a type-level import test or explicit export test.

> Task 39: “Server-side helpers (`fetchProviderAvailability`, `fetchBadgeLag` when called from server components) reuse `server-api-fetch`; mutating helpers and any browser-only calls use `client-api-fetch`.”

Acceptance only says Task 38 passes. It does not verify dual server/client use, and `useLiveBadge` requires client-side `fetchBadgeLag`.

> Task 130: “build manifest lists `/console`.”

That is not an easy acceptance check unless the builder knows where to inspect. Prefer build success plus manual redirect behavior, or add a route existence test.

## 3. Test Gaps

The biggest test gap is test infrastructure itself. The LLD asks for many `apps/web/__tests__` files, but `@argus/web` has no `test` script, Jest config, jsdom setup, or Testing Library dependencies. Add an early RED/GREEN or scaffold task for test setup.

`ConsoleLiveProvider` tests do not cover validation/error behavior from `SseClient` into the provider. If transport errors matter for UI state, test ignored/error flow or explicitly state provider only forwards valid ticks.

`console-api` tests do not cover URL encoding for repeated multi-value filters even though filter encoding says multi-value filters use repeated keys.

`useLiveBadge` does not test stale responses after unmount or out-of-order polling responses. A 1s polling hook can easily set state after unmount unless guarded.

`ClearModal` tests cover happy submit, but not `executeClear` failure. The UI needs a recoverable error path for a destructive operation.

`ReplayTab`, `TracesTab`, and `CostTab` have no TDD coverage despite containing important orchestration: live subscription, debounced refetch, URL navigation, and replay run state.

`ProviderSelector` tests do not cover localStorage persistence or WS send-frame integration from Task 139.

## 4. File-Path Errors

> `apps/web/lib/ws-client.ts`

Not present.

> `apps/web/components/chat/ChatTopbar.tsx` / `MessageStream.tsx`

Not present in the current repo.

> `/login`, `/signup`, `/chat`, `/chat/[conversationId]`

Not present.

> `apps/web/__tests__/...`

No existing test setup or convention under `apps/web`.

> `packages/contracts/__tests__/...`

No existing test directory or Jest config was found. The package has Jest dependencies, but no config.

> `server-session`, `server-api-fetch`, `client-api-fetch`

No paths are given and these helpers are not present in the visible repo.

Also, the scaffold facts claim:

> “React 18.3.x”

Current `apps/web/package.json` has React `^19.0.0`.

## 5. Hand-Off Risk

The LLD is written as if Phase A is already fully implemented, but the current repo does not match that assumption. A builder following this literally will spend most of the time inventing missing Phase A primitives.

The contract boundary is risky. Frontend tasks depend on backend-authored schemas, but Task 1A asks frontend to write tests for every schema before schemas exist. That is fine conceptually, but the DTO shapes are underspecified: many fields are implied only inside component task examples.

The REST client/server-client split is unclear. `fetchBadgeLag` is used by a client hook, while Task 39 says server-side helpers reuse `server-api-fetch`. That can lead to importing server-only code into client bundles.

The SSE contract is underdefined. It mentions a tick payload `{ user_id, kind, conversation_id }` and heartbeat variant, but tests later refer to `kind === 'chat'` and `kind === 'classifier'` without defining allowed values.

The LLD over-specifies assertion mechanics but under-specifies product contracts. Builders need exact DTOs, endpoint response shapes, and existing helper paths more than test spy details.

## 6. Quality Score

4/10.

The plan is comprehensive in intent, but it is not ready to hand off against this repo. It has hard format violations, assumes nonexistent Phase A files/test setup, and leaves several critical contracts ambiguous. The next revision should first reconcile scaffold facts with the actual repository, add missing prerequisite tasks, and shrink the large UI orchestration tasks.
