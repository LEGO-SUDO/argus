---
phase: lld
status: APPROVED
slug: argus
scope: phase-a
domain: frontend-web
builder: frontend-web-worker
created: 2026-05-23
updated: 2026-05-23
---

# LLD: frontend-web — Argus Phase A

Phase A web surface only. This LLD covers `/login`, `/signup`, `/chat`, `/chat/[conversationId]`, the WS streaming reducer, the user-scoped conversation list, logout, the typed WS client, and the "N earlier messages omitted from context" indicator. Phase B (`/console`) is out of scope.

## Scaffold facts (verified against repo at LLD-write time)

- Workspace manager: pnpm 10.33.3, Node 20.
- Path aliases configured in `apps/web/tsconfig.json`: `@/*` → `apps/web/*`, `@argus/contracts` → `packages/contracts/src/index.ts`, `@argus/contracts/*` → `packages/contracts/src/*`. Frontend code uses **`@argus/contracts/...`** for shared types; **no new alias** is introduced by this LLD.
- **Next.js 15.5.x**, App Router, React 18.3.x, no `src/` directory — pages live directly under `apps/web/app/`. **Next 15 async-API surface applies throughout this LLD:** `cookies()`, `headers()`, and `draftMode()` from `next/headers` all return `Promise<...>` and must be `await`-ed; Server Component route `params` and `searchParams` are also `Promise<...>` and must be `await`-ed before destructuring. Default `fetch()` caching is `no-store` (was `force-cache` in Next 14) — server-side data helpers in this LLD pass `{ cache: 'no-store' }` explicitly for clarity since they are session-bound live data.
- Tailwind 3.4 is already installed; Tailwind config + `globals.css` may or may not exist yet — Tasks check and create only if missing.
- Per-workspace scripts use **`typecheck`** (not `type-check`). Verify commands must use `pnpm --filter @argus/web typecheck`.
- Root-level commands run via Turbo: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`.
- Test runner: Jest with `--passWithNoTests` baseline in `packages/contracts`. **For `apps/web` this LLD adds Jest + React Testing Library + jsdom** (the scaffold currently has no test runner in `apps/web`). Test file glob `**/*.test.ts(x)` under `apps/web/__tests__/`.
- `packages/contracts/src/index.ts` is currently a placeholder. The contract authoring Tasks below add the WS and DTO exports; backend-api and frontend-web both consume the same export names.

## Coordinated contract exports

`packages/contracts/src/` must expose the following named exports before this LLD's transport/page tasks land. Both this LLD and the backend-api LLD assume these names — they MUST agree.

- `packages/contracts/src/ws.ts`
  - `WsFrameSchema` (zod) — discriminated union over `type` for all server→client frames.
  - `WsServerFrame` (TS type inferred from `WsFrameSchema`).
  - `WsClientFrameSchema` (zod) — discriminated union over `type` for all client→server frames (`send`, `cancel`).
  - `WsClientFrame` (TS type inferred from `WsClientFrameSchema`).
  - Frame-name string-literal constants: `'start' | 'token' | 'end' | 'error' | 'cancel-ack' | 'canceled'` for server→client; `'send' | 'cancel'` for client→server. Per HLD D2.
- `packages/contracts/src/dto.ts`
  - `LoginRequestSchema`, `LoginResponseSchema`, `SignupRequestSchema`, `SignupResponseSchema`.
  - `ConversationDtoSchema`, `MessageDtoSchema`, `MessageListResponseSchema` (with `messages: MessageDto[]` and `omitted_count: number`).
  - `SessionUserDtoSchema` (returned by `/auth/session`).
  - All companion TS types inferred from schemas.
- `packages/contracts/src/index.ts` re-exports the above.

If a frontend task starts before the contract task has landed, the frontend worker pauses that task and surfaces the dependency to the lead — no contract stubs are invented in `apps/web/`. (See Tasks 1A–1C below for the early contract-author work this LLD owns; backend-api LLD owns the OTel + projection exports.)

## Reducer state model (defined once, evolved by tasks)

`message-stream-reducer.ts` owns a single per-conversation state shape with these named slots (described in prose, exact field names left to the worker — but slots must exist):

- A **message log** ordered oldest-first, each entry tagged with role (`user` | `assistant` | `system`), status (`streaming` | `complete` | `canceled` | `failed`), content, optional provider+model labels, optional error code.
- A **streaming-bubble pointer** (null when no turn is in flight) identifying which assistant message is the active streaming target — pointer carries `message_id`, last applied `seq`, and the provider+model from the `start` frame.
- A **composer lock** boolean — true while a turn is in flight, false otherwise. The `end`, `error`, and `canceled` handlers each clear it.
- An **omitted count** — non-negative integer, hydrated from `init`, displayed by `OmittedIndicator` when > 0.
- A **terminal error** slot (null when no top-level failure) — set when an `error` frame arrives without an active streaming bubble (e.g. `no_providers_available` before any provider was selected).
- A **retry context** map keyed by failed-message id, recording the source user text that produced the failed turn so Retry can resend it.

All actions return a new state object; the reducer is pure (no I/O, no timers, no React).

## Optimistic IDs and retry semantics

- **Composer-submitted IDs.** Locally optimistic user messages use a client-generated string id with the prefix `local-` followed by a `crypto.randomUUID()` value, so they are visually distinguishable from server-issued `message_id` values (which come back on the `start` frame for the *assistant* turn). The user message does not need a server id in Phase A — it is persisted server-side from the `send` frame's payload.
- **Retry behavior.** Retry on a failed assistant message **reuses the same user-message turn** (no duplicate user bubble). The reducer's retry action looks up the retry-context entry for that failed assistant message, clears the failed assistant entry (or marks it superseded — worker's choice as long as it disappears from view), dispatches a new `send` WS frame carrying the original text, and re-locks the composer. A second retry on the same failed message is allowed only after the first retry produces a terminal frame.

## WS URL construction

`ws-client.ts` builds the socket URL from `NEXT_PUBLIC_WS_URL` (default `ws://localhost:4000/chat`). Two cases:

- **Existing conversation:** append `?conversation_id=<id>`.
- **New conversation (null id at page load):** open with no query param; the server mints `conversation_id` on the first `start` frame, and the client calls `router.replace('/chat/<id>')` on receipt (Tasks 53–54).

The socket sends the session cookie automatically when the WS host is same-origin via the Next.js dev/prod proxy. The LLD assumes same-origin proxying; cross-origin WS auth is out of scope for Phase A (flagged in Open Questions).

## File Structure

Each file has one clear responsibility. Auth and chat are colocated under Next.js App Router route groups; reusable chat pieces live under `apps/web/components/chat`; transport and data fetching live under `apps/web/lib`.

### Routes / pages (Next.js App Router under `apps/web/app/`)

- `apps/web/app/(auth)/layout.tsx` — minimal layout wrapper for the auth route group (no nav, centered card).
- `apps/web/app/(auth)/login/page.tsx` — client component hosting the login form, inline error states, post-success redirect to `/chat`.
- `apps/web/app/(auth)/signup/page.tsx` — client component hosting the signup form including duplicate-email inline error and post-success redirect to `/chat`.
- `apps/web/app/chat/layout.tsx` — server component; auth-gated layout: calls `server-session.ts`, renders sidebar (`ConversationList`) plus child content; redirects unauthenticated requests to `/login`.
- `apps/web/app/chat/page.tsx` — server component shell for the new-conversation case; renders the `MessageStream` client with a null conversation id.
- `apps/web/app/chat/[conversationId]/page.tsx` — server component; fetches message history for that conversation via the server-side REST helper, passes initial messages to `MessageStream`.

### Chat components (`apps/web/components/chat/`)

- `apps/web/components/chat/MessageStream.tsx` — client component: holds per-conversation message log via the reducer; renders messages, the streaming assistant bubble, the cancel button, the retry button on failed turns, the "interrupted" marker after refresh-during-stream, the active-provider+model label per turn, the "N earlier messages omitted from context" indicator, and the top-level terminal-error banner. Disables the composer while streaming. Accepts the WS client via a `wsClient` prop (test injects a stub); when the prop is omitted, the component constructs a default `WsClient` via the URL-construction rule above.
- `apps/web/components/chat/MessageComposer.tsx` — client component: input + send button; `disabled` and `onSend(text)` props.
- `apps/web/components/chat/MessageList.tsx` — pure render: takes the message log, renders each item based on role and status (delegates provider/model label rendering for assistant messages).
- `apps/web/components/chat/ConversationList.tsx` — **client component** (`'use client'`) that takes the conversation array as a prop and uses `usePathname()` from `next/navigation` to derive the active conversation id from the URL. Empty state renders "No conversations yet — start a new chat" with a link to `/chat`. Active conversation row carries `aria-current="page"`.
- `apps/web/components/chat/LogoutButton.tsx` — client component: one-click POST to `/api/auth/logout`, then `router.push('/login')`.
- `apps/web/components/chat/OmittedIndicator.tsx` — pure render: renders "N earlier messages omitted from context" when N > 0, returns null otherwise.

### Reducer + transport (`apps/web/lib/`)

- `apps/web/lib/message-stream-reducer.ts` — pure reducer; exports `reducer(state, action)` and `initialState`. Owns all state transitions described in the state-model section above.
- `apps/web/lib/ws-client.ts` — typed WS client class: `new WsClient(url)`; methods `send(frame)`, `onFrame(handler)`, `onError(handler)`, `onClose(handler)`, `close()`. Validates every inbound message via `WsFrameSchema`. Drops handlers on `close()`.
- `apps/web/lib/client-api-fetch.ts` — **browser-side** thin wrapper over `fetch`. Always sets `credentials: 'include'` so the session cookie is forwarded. Parses JSON, throws `AuthError` on 401, throws `ApiError` (with status + parsed body when JSON) on other non-2xx, returns parsed JSON on 2xx.
- `apps/web/lib/server-api-fetch.ts` — **server-side** (Node-only) thin wrapper. Reads cookies via `next/headers`'s `cookies()` — **note: in Next.js 15 `cookies()` returns a `Promise` and must be awaited** — and forwards them as a manual `Cookie:` header. The wrapper itself is therefore an `async` function. All `fetch` calls it issues are uncached (Next 15 default is `no-store` for `fetch`; the wrapper passes `{ cache: 'no-store' }` explicitly to make intent unambiguous, since these are live session-bound API calls). Same error contract as `client-api-fetch.ts`. Importing this from a Client Component must fail loudly (file begins with `import 'server-only'`).
- `apps/web/lib/conversations-api.ts` — REST helpers `listConversations()`, `getConversation(id)`, `getMessages(conversationId)`. Server-only paths (used by `app/chat/layout.tsx` and `app/chat/[conversationId]/page.tsx`) — file uses `server-api-fetch`. Returns typed DTOs from `@argus/contracts`. (No client-side counterpart needed for Phase A; the only client REST call is logout, which lives in `LogoutButton.tsx` and uses `client-api-fetch`.)
- `apps/web/lib/server-session.ts` — server-only helper. Reads the session cookie named `argus_session` from `next/headers` — **note: in Next.js 15 `cookies()` is async and must be awaited before calling `.get()`** — then calls the API endpoint `GET /auth/session` via `server-api-fetch`, returns `SessionUserDto` on success or `null` on missing/invalid/401. The helper itself is therefore an `async` function. File begins with `import 'server-only'`.

### Test files (`apps/web/__tests__/` mirrors source path exactly)

- `apps/web/__tests__/lib/message-stream-reducer.test.ts`
- `apps/web/__tests__/lib/ws-client.test.ts`
- `apps/web/__tests__/lib/client-api-fetch.test.ts`
- `apps/web/__tests__/lib/server-api-fetch.test.ts`
- `apps/web/__tests__/lib/server-session.test.ts`
- `apps/web/__tests__/lib/conversations-api.test.ts`
- `apps/web/__tests__/components/chat/MessageStream.test.tsx`
- `apps/web/__tests__/components/chat/ConversationList.test.tsx`
- `apps/web/__tests__/components/chat/OmittedIndicator.test.tsx`
- `apps/web/__tests__/components/chat/LogoutButton.test.tsx`
- `apps/web/__tests__/app/(auth)/login.test.tsx`
- `apps/web/__tests__/app/(auth)/signup.test.tsx`
- `apps/web/__tests__/app/chat/layout.test.tsx`
- `apps/web/__tests__/app/chat/[conversationId]/page.test.tsx`

### Config / scaffolding (`apps/web/`)

- `apps/web/package.json` — scripts already include `dev`, `build`, `start`, `lint`, `typecheck`, `clean`. This LLD adds `test` and `test:watch`.
- `apps/web/jest.config.ts` — Jest config (jsdom environment, ts-jest transform, setup file).
- `apps/web/jest.setup.ts` — RTL cleanup + `@testing-library/jest-dom` matchers.
- `apps/web/next.config.mjs` — scaffold has `reactStrictMode` and `transpilePackages: ['@argus/contracts']`. This LLD adds a rewrites block: `/api/:path*` → `${process.env.API_URL ?? 'http://localhost:4000'}/:path*` (server-only env, not `NEXT_PUBLIC_*`).
- `apps/web/app/layout.tsx` — root layout (html/body) with global CSS import.
- `apps/web/app/globals.css` — Tailwind base + minimal global styles.
- `apps/web/tailwind.config.ts` + `apps/web/postcss.config.mjs` — Tailwind setup.

---

## Tasks

> Verify commands assume repo root (`/Users/lego/Desktop/personal-projects/argus`) as the working directory. Package filter syntax is `pnpm --filter @argus/web <script>`. Per-test-file filtering uses `pnpm --filter @argus/web test -- <pathOrPattern>`.

### Phase 0: Contract authoring (frontend-web owns the auth+conversation DTOs; backend-api owns the OTel/projection ones — both edit `packages/contracts/src/`)

#### Task 1A (RED): Failing test for `WsFrameSchema` round-trips a valid `start` frame
**Files:** `packages/contracts/__tests__/ws.test.ts`
**What to do:** Write a failing test asserting that `WsFrameSchema.parse(...)` accepts a valid `start` frame (with `type`, `message_id`, `conversation_id`, `provider`, `model`) and rejects a frame missing `message_id`.
**Acceptance:** Test exists, runs, fails because `packages/contracts/src/ws.ts` does not yet exist.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts` reports the expected failure.

#### Task 1B (GREEN): Implement `WsFrameSchema` `start` variant
**Files:** `packages/contracts/src/ws.ts`, `packages/contracts/src/index.ts`
**What to do:** Create `ws.ts` exporting `WsFrameSchema` as a zod discriminated union with the `start` variant defined; re-export from `index.ts`.
**Acceptance:** Task 1A passes; no other tests broken.
**Verify:** `pnpm --filter @argus/contracts test`.

#### Task 1C (RED+GREEN): Add remaining server→client frame variants
**Files:** `packages/contracts/__tests__/ws.test.ts`, `packages/contracts/src/ws.ts`
**What to do:** For each of `token`, `end`, `error`, `cancel-ack`, `canceled`, add a failing schema round-trip test (one variant per RED check), then extend `WsFrameSchema` to satisfy each. Group as one task — each variant is one minute of work; splitting further is over-decomposition.
**Acceptance:** Each variant parses a representative valid frame and rejects a frame missing a required field for that variant.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts`.

#### Task 1D (RED): Failing test for `WsClientFrameSchema` `send` and `cancel`
**Files:** `packages/contracts/__tests__/ws.test.ts`
**What to do:** Write failing tests for `WsClientFrameSchema` round-trip of a `send` frame (carrying `text` and optional `conversation_id`) and a `cancel` frame (carrying `message_id`).
**Acceptance:** Tests run and fail because the export does not exist.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts` reports the expected failures.

#### Task 1E (GREEN): Implement `WsClientFrameSchema`
**Files:** `packages/contracts/src/ws.ts`, `packages/contracts/src/index.ts`
**What to do:** Add `WsClientFrameSchema` as a zod discriminated union over the two client→server frame types. Re-export.
**Acceptance:** Task 1D tests pass.
**Verify:** `pnpm --filter @argus/contracts test`.

#### Task 1F (RED+GREEN): Auth + conversation DTO schemas
**Files:** `packages/contracts/__tests__/dto.test.ts`, `packages/contracts/src/dto.ts`, `packages/contracts/src/index.ts`
**What to do:** For each of `LoginRequestSchema`, `LoginResponseSchema`, `SignupRequestSchema`, `SignupResponseSchema`, `SessionUserDtoSchema`, `ConversationDtoSchema`, `MessageDtoSchema`, `MessageListResponseSchema`, write one round-trip happy-path test (RED) and implement the schema (GREEN). Group as one task since each is a few lines.
**Acceptance:** All DTO tests pass; the index re-exports each schema and its inferred type.
**Verify:** `pnpm --filter @argus/contracts test`.

---

### Phase 1: `apps/web` config and test-runner scaffolding (non-TDD — config files)

#### Task 2: [non-TDD — scripts] Add `test` and `test:watch` scripts to `apps/web/package.json`
**Files:** `apps/web/package.json`
**What to do:** Add `test: "jest"` and `test:watch: "jest --watch"` to the `scripts` block. Add Jest, ts-jest, `@types/jest`, `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event` to `devDependencies` at versions compatible with React 18 and TypeScript 5.6.
**Acceptance:** `pnpm --filter @argus/web run test --` exits non-zero with a "no tests found" message (Jest installed, no tests yet).
**Verify:** `pnpm install && pnpm --filter @argus/web exec jest --listTests` exits 0 and prints an empty list.

#### Task 3: [non-TDD — Jest config] Create `jest.config.ts`
**Files:** `apps/web/jest.config.ts`
**What to do:** Configure Jest with jsdom test environment, ts-jest preset, module name mapper that resolves `^@/(.*)$` to `apps/web/$1` and `^@argus/contracts(.*)$` to `packages/contracts/src/index.ts` (or `packages/contracts/src/$1` for the wildcard form), and `setupFilesAfterEach: ['<rootDir>/jest.setup.ts']`. Test match `**/__tests__/**/*.test.ts(x)`.
**Acceptance:** A throwaway smoke test at `apps/web/__tests__/smoke.test.ts` asserting `expect(1 + 1).toBe(2)` runs green.
**Verify:** `pnpm --filter @argus/web test -- smoke.test.ts` exits 0. (Delete the smoke test after this task.)

#### Task 4: [non-TDD — Jest setup] Create `jest.setup.ts`
**Files:** `apps/web/jest.setup.ts`
**What to do:** Import `@testing-library/jest-dom` to register matchers; add an `afterEach(cleanup)` from `@testing-library/react`.
**Acceptance:** A throwaway RTL test asserting `screen.getByText('hi')` after rendering `<div>hi</div>` passes.
**Verify:** `pnpm --filter @argus/web test`. (Delete the throwaway test after this task.)

#### Task 5: [non-TDD — Next config] Add the `/api/:path*` rewrite to `next.config.mjs`
**Files:** `apps/web/next.config.mjs`
**What to do:** Extend the existing `nextConfig` with an async `rewrites()` that returns one rule: source `/api/:path*`, destination `${process.env.API_URL ?? 'http://localhost:4000'}/:path*`. Keep `reactStrictMode` and `transpilePackages` unchanged. `API_URL` is server-only (not prefixed `NEXT_PUBLIC_`).
**Acceptance:** `pnpm --filter @argus/web build` exits 0 and the build output contains the rewrite entry.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 6: [non-TDD — root layout] Create `apps/web/app/layout.tsx`
**Files:** `apps/web/app/layout.tsx`, `apps/web/app/globals.css`
**What to do:** Create a minimal root layout exporting a default function returning `<html lang="en"><body>{children}</body></html>`; import `./globals.css`. Create `globals.css` with `@tailwind base; @tailwind components; @tailwind utilities;`.
**Acceptance:** `pnpm --filter @argus/web build` exits 0 and the build manifest lists `/` (root segment) as present.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 7: [non-TDD — Tailwind] Add `tailwind.config.ts` and `postcss.config.mjs` if absent
**Files:** `apps/web/tailwind.config.ts`, `apps/web/postcss.config.mjs`
**What to do:** Create standard Tailwind 3.4 config with `content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}']`. Create PostCSS config exporting `tailwindcss` and `autoprefixer` plugins. If either file already exists, leave it untouched.
**Acceptance:** Visiting the dev server's root URL after `pnpm --filter @argus/web dev` shows a page whose `<html>` carries Tailwind preflight styles.
**Verify:** `pnpm --filter @argus/web build`.

---

### Phase 2: Reducer (RED → GREEN pairs)

#### Task 8 (RED): Reducer `init` hydration
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: dispatching an `init` action with an array of historical messages produces state whose message log mirrors the input, with no active streaming bubble.
**Acceptance:** Test exists and fails because the reducer module is missing.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the expected failure.

#### Task 9 (GREEN): Implement `init`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Create the module exporting `reducer` and `initialState`; handle the `init` action only.
**Acceptance:** Task 8 passes.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 10 (RED): Reducer `start` frame opens streaming bubble
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: dispatching a `start` frame transitions the reducer to a streaming state for the given `message_id`, with empty content and labelled provider/model. The test file owns exact assertions.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 11 (GREEN): Implement `start`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `start` per Task 10.
**Acceptance:** Tasks 8, 10 pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 12 (RED): Reducer `token` appends in seq order and ignores out-of-order
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `token` frames with monotonically increasing `seq` append their delta to the active streaming bubble; a `token` with `seq` less than or equal to the last applied is ignored.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 13 (GREEN): Implement `token` with seq filtering
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `token` per Task 12.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 14 (RED): Reducer `token` for a different `message_id` is ignored
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: while a streaming bubble exists for `message_id="A"`, a `token` frame carrying `message_id="B"` does not modify state.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 15 (GREEN): Implement `message_id` mismatch guard
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Extend the `token` handler to ignore frames whose `message_id` does not match the active streaming bubble.
**Acceptance:** Task 14 passes; previous reducer tests unchanged.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 16 (RED): Reducer `end` promotes streaming bubble to `complete`
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `end` moves the streaming bubble into the message log with status `complete`, preserves accumulated content, clears the streaming pointer, and re-enables the composer.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 17 (GREEN): Implement `end`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `end` per Task 16.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 18 (RED): Reducer `error` marks turn `failed` and records retry context
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `error` moves the streaming bubble into the log with status `failed`, preserves partial content, records the error code, sets a retryable flag, clears the streaming pointer, re-enables the composer, and stores the prior user-message text under the failed message's retry context entry.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 19 (GREEN): Implement `error`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `error` per Task 18. Retry context lookup must walk the log backward from the failed assistant message to find the most recent user message that triggered this turn.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 20 (RED): Reducer top-level terminal error (`no_providers_available`)
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: an `error` frame arriving with no active streaming bubble (e.g. provider selection failed before `start`) sets the top-level terminal-error slot with the error code, leaves the message log untouched, and leaves the composer enabled.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 21 (GREEN): Implement top-level terminal-error handling
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Extend the `error` handler to write to the terminal-error slot when no streaming bubble is active.
**Acceptance:** Task 20 passes; existing reducer tests unchanged.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 22 (RED): Reducer `canceled` frame + late-token guard
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `canceled` promotes the streaming bubble to status `canceled` with partial content preserved and clears the streaming pointer; a subsequent `token` frame for the same `message_id` does not re-create a streaming bubble and does not modify the canceled message. (Addresses HLD Regression Risk Surface: cancel transitions exactly once even if a late token races the cancel-ack.)
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 23 (GREEN): Implement `canceled` and the terminal-state late-frame guard
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `canceled` per Task 22; add a guard that ignores any inbound frame whose `message_id` matches a message already in the log with a terminal status (`complete | failed | canceled`).
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 24 (RED): Reducer `cancel-ack` frame
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `cancel-ack` arriving for an active streaming bubble does not alter the message log or streaming pointer (the `canceled` frame is the authoritative terminal); the reducer simply accepts it without throwing. A `cancel-ack` for an unknown `message_id` is also accepted without state change.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 25 (GREEN): Implement `cancel-ack` as no-op
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Add a `cancel-ack` case that returns state unchanged.
**Acceptance:** Task 24 passes.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 26 (RED): Reducer `composer-submitted` appends user message and locks composer
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `composer-submitted` with `{ text, localId }` appends a user-role message with status `complete` to the log and sets the composer lock; a second `composer-submitted` while locked is rejected (state unchanged).
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 27 (GREEN): Implement `composer-submitted` with single-in-flight lock
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `composer-submitted` per Task 26.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 28 (RED): Reducer `retry` reuses failed turn (no duplicate user bubble)
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: a `retry` action targeting a `failed` assistant message removes that failed assistant entry from the log, leaves the prior user message in place, locks the composer, and exposes the retry text via the returned action result (or via state) so the component can forward it to `ws-client.send`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 29 (GREEN): Implement `retry`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Handle `retry` per Task 28.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

#### Task 30 (RED): Reducer `init` accepts `omittedCount`
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Failing test for the behavior: `init` with `omittedCount: 5` produces state whose omitted-count slot equals 5; omitted defaults to 0 when not provided.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts` reports the new failure.

#### Task 31 (GREEN): Extend `init` to read `omittedCount`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Update the `init` handler per Task 30.
**Acceptance:** Reducer tests so far pass.
**Verify:** `pnpm --filter @argus/web test -- message-stream-reducer.test.ts`.

---

### Phase 3: Pure components

#### Task 32 (RED): `OmittedIndicator` visibility threshold
**Files:** `apps/web/__tests__/components/chat/OmittedIndicator.test.tsx`
**What to do:** Failing test for the behavior: `<OmittedIndicator count={0} />` renders nothing; `<OmittedIndicator count={3} />` renders accessible text mentioning "3 earlier messages omitted".
**Acceptance:** Test runs and fails because the component is missing.
**Verify:** `pnpm --filter @argus/web test -- OmittedIndicator.test.tsx` reports the expected failure.

#### Task 33 (GREEN): Implement `OmittedIndicator`
**Files:** `apps/web/components/chat/OmittedIndicator.tsx`
**What to do:** Implement the pure component per Task 32.
**Acceptance:** Task 32 passes.
**Verify:** `pnpm --filter @argus/web test -- OmittedIndicator.test.tsx`.

#### Task 34 (RED): `ConversationList` empty state
**Files:** `apps/web/__tests__/components/chat/ConversationList.test.tsx`
**What to do:** Failing test for the behavior: rendering the list with an empty array shows "No conversations yet" and a link labelled "Start a new chat" pointing to `/chat`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ConversationList.test.tsx` reports the expected failure.

#### Task 35 (GREEN): Implement `ConversationList` empty state
**Files:** `apps/web/components/chat/ConversationList.tsx`
**What to do:** Implement the empty-state branch per Task 34. Component is `'use client'` and calls `usePathname()` from `next/navigation` (mock it in the test).
**Acceptance:** Task 34 passes.
**Verify:** `pnpm --filter @argus/web test -- ConversationList.test.tsx`.

#### Task 36 (RED): `ConversationList` populated + active highlight via `usePathname`
**Files:** `apps/web/__tests__/components/chat/ConversationList.test.tsx`
**What to do:** Failing test for the behavior: given three conversations with ids `a`, `b`, `c` and a mocked `usePathname` returning `/chat/b`, the list renders three links to `/chat/<id>` and the link for `b` carries `aria-current="page"`.
**Acceptance:** Test runs and fails because populated rendering is not implemented.
**Verify:** `pnpm --filter @argus/web test -- ConversationList.test.tsx` reports the new failure.

#### Task 37 (GREEN): Implement `ConversationList` populated rendering
**Files:** `apps/web/components/chat/ConversationList.tsx`
**What to do:** Extend the component to render the populated list with `aria-current` derived from `usePathname()`.
**Acceptance:** All `ConversationList` tests pass.
**Verify:** `pnpm --filter @argus/web test -- ConversationList.test.tsx`.

#### Task 38 (RED): `LogoutButton` click → POST + redirect
**Files:** `apps/web/__tests__/components/chat/LogoutButton.test.tsx`
**What to do:** Failing test that mocks `fetch` and `next/navigation`'s `useRouter`, clicks the button, and verifies the behavior: `fetch` is called with `/api/auth/logout` and method `POST`, then `router.push('/login')` is called after the promise resolves.
**Acceptance:** Test runs and fails because the component is missing.
**Verify:** `pnpm --filter @argus/web test -- LogoutButton.test.tsx` reports the expected failure.

#### Task 39 (GREEN): Implement `LogoutButton`
**Files:** `apps/web/components/chat/LogoutButton.tsx`
**What to do:** Implement the click handler per Task 38, using `client-api-fetch`.
**Acceptance:** Task 38 passes.
**Verify:** `pnpm --filter @argus/web test -- LogoutButton.test.tsx`.

---

### Phase 4: Transport helpers

#### Task 40 (RED): `client-api-fetch` sets `credentials: 'include'`, parses JSON, throws `AuthError` on 401
**Files:** `apps/web/__tests__/lib/client-api-fetch.test.ts`
**What to do:** Failing test using a global `fetch` mock for three behaviors: (a) the call passes `credentials: 'include'` in the request init; (b) a 200 JSON response is parsed and returned; (c) a 401 throws a typed `AuthError`.
**Acceptance:** Test runs and fails because the module is missing.
**Verify:** `pnpm --filter @argus/web test -- client-api-fetch.test.ts` reports the expected failure.

#### Task 41 (GREEN): Implement `client-api-fetch`
**Files:** `apps/web/lib/client-api-fetch.ts`
**What to do:** Implement per Task 40 — also throw `ApiError` (extends Error, carries `status`, `body`) on any other non-2xx.
**Acceptance:** Task 40 passes.
**Verify:** `pnpm --filter @argus/web test -- client-api-fetch.test.ts`.

#### Task 42 (RED): `client-api-fetch` non-JSON error body handling
**Files:** `apps/web/__tests__/lib/client-api-fetch.test.ts`
**What to do:** Failing test for the behavior: a 500 response with `Content-Type: text/plain` throws `ApiError` whose `body` is the raw text (no crash on JSON parse).
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- client-api-fetch.test.ts` reports the new failure.

#### Task 43 (GREEN): Harden `client-api-fetch` against non-JSON bodies
**Files:** `apps/web/lib/client-api-fetch.ts`
**What to do:** Detect non-JSON content type and surface raw text on the error.
**Acceptance:** Task 42 passes.
**Verify:** `pnpm --filter @argus/web test -- client-api-fetch.test.ts`.

#### Task 44 (RED): `server-api-fetch` forwards cookies via `next/headers`
**Files:** `apps/web/__tests__/lib/server-api-fetch.test.ts`
**What to do:** Failing test that mocks `next/headers`'s `cookies()` — **Next 15: `cookies()` is async**, so the mock must resolve to a fake cookie store (with a `.get(name)` that returns `{ name, value }` for `argus_session=abc`), not return one synchronously. The test mocks `fetch`, `await`s the helper, and asserts the outbound `fetch` carried a `Cookie: argus_session=abc` header.
**Acceptance:** Test runs and fails because the module is missing.
**Verify:** `pnpm --filter @argus/web test -- server-api-fetch.test.ts` reports the expected failure.

#### Task 45 (GREEN): Implement `server-api-fetch`
**Files:** `apps/web/lib/server-api-fetch.ts`
**What to do:** Implement per Task 44; begin the file with `import 'server-only'`. The exported function is `async` and must `await cookies()` (Next 15 — `cookies()` returns a Promise) before reading the session cookie and building the `Cookie:` header. Pass `{ cache: 'no-store' }` to the underlying `fetch` call (matches Next 15's default, but explicit so reviewers can see intent). Mirror `client-api-fetch`'s error contract (`AuthError` / `ApiError`).
**Acceptance:** Task 44 passes.
**Verify:** `pnpm --filter @argus/web test -- server-api-fetch.test.ts`.

#### Task 46 (RED): `server-api-fetch` 401 → `AuthError`
**Files:** `apps/web/__tests__/lib/server-api-fetch.test.ts`
**What to do:** Failing test for the behavior: a 401 from the upstream throws `AuthError`.
**Acceptance:** Test runs and fails (if not already covered by Task 45) or passes immediately. If immediate pass, escalate: remove this RED and add a behavior the task does not cover yet, e.g. parsing a JSON 200 body. (Worker decides which test to add to keep the RED honest.)
**Verify:** `pnpm --filter @argus/web test -- server-api-fetch.test.ts`.

#### Task 47 (GREEN): Satisfy Task 46
**Files:** `apps/web/lib/server-api-fetch.ts`
**What to do:** Implement whichever behavior Task 46 ended up specifying.
**Acceptance:** Task 46 passes.
**Verify:** `pnpm --filter @argus/web test -- server-api-fetch.test.ts`.

#### Task 48 (RED): `server-session` returns user on valid cookie, null on missing/invalid
**Files:** `apps/web/__tests__/lib/server-session.test.ts`
**What to do:** Failing tests for three behaviors: (a) no `argus_session` cookie → returns `null` without calling fetch; (b) cookie present + upstream returns 200 with valid `SessionUserDto` → returns the parsed user; (c) cookie present + upstream returns 401 → returns `null`. **Next 15: mocks for `next/headers`'s `cookies()` must resolve to the fake store asynchronously** (the helper itself awaits `cookies()` before reading `.get('argus_session')`); tests must `await` the helper since it is `async`.
**Acceptance:** Tests run and fail because the module is missing.
**Verify:** `pnpm --filter @argus/web test -- server-session.test.ts` reports the expected failures.

#### Task 49 (GREEN): Implement `server-session`
**Files:** `apps/web/lib/server-session.ts`
**What to do:** Implement per Task 48 using `server-api-fetch` against `/auth/session`. The exported helper is `async` and must `await cookies()` (Next 15) before calling `.get('argus_session')` to check for the cookie's presence. If absent, return `null` without issuing a fetch. Begin file with `import 'server-only'`.
**Acceptance:** Task 48 passes.
**Verify:** `pnpm --filter @argus/web test -- server-session.test.ts`.

#### Task 50 (RED): `conversations-api` calls the right paths and returns typed DTOs
**Files:** `apps/web/__tests__/lib/conversations-api.test.ts`
**What to do:** Failing tests for three behaviors: `listConversations()` hits `/conversations` and returns the parsed array; `getConversation(id)` hits `/conversations/<id>`; `getMessages(id)` hits `/conversations/<id>/messages` and returns `{ messages, omitted_count }`.
**Acceptance:** Tests run and fail because the module is missing.
**Verify:** `pnpm --filter @argus/web test -- conversations-api.test.ts` reports the expected failures.

#### Task 51 (GREEN): Implement `conversations-api`
**Files:** `apps/web/lib/conversations-api.ts`
**What to do:** Implement per Task 50 using `server-api-fetch` and the `@argus/contracts` DTO schemas to validate the responses (call `Schema.parse(...)` on the parsed body before returning).
**Acceptance:** Task 50 passes.
**Verify:** `pnpm --filter @argus/web test -- conversations-api.test.ts`.

---

### Phase 5: WS client

#### Task 52 (RED): `WsClient` constructor opens a WebSocket to the configured URL
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test that stubs the global `WebSocket` constructor, instantiates `new WsClient('ws://localhost:4000/chat?conversation_id=c1')`, and asserts the stub was called once with that URL.
**Acceptance:** Test runs and fails because the module is missing.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the expected failure.

#### Task 53 (GREEN): Implement `WsClient` constructor + `close()`
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Implement the class with a constructor that opens a `WebSocket` to the provided URL and a `close()` method.
**Acceptance:** Task 52 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 54 (RED): `WsClient` validates inbound frames and dispatches to `onFrame`
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test that registers `onFrame`, dispatches a synthetic `message` event whose `data` is a JSON-serialised valid `start` frame, and asserts `onFrame` was called with the parsed frame; then dispatches a frame missing a required field and asserts `onFrame` was NOT called and `onError` received a validation reason.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 55 (GREEN): Implement inbound frame validation
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Parse the incoming `data` as JSON, validate against `WsFrameSchema` from `@argus/contracts`, route valid frames to `onFrame` and invalid ones to `onError` with a structured reason.
**Acceptance:** Task 54 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 56 (RED): `WsClient` malformed JSON triggers `onError` (not a throw)
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test for the behavior: a `message` event whose `data` is `not-json{` triggers `onError` with a parse-error reason and does not throw out of the dispatcher.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 57 (GREEN): Catch JSON parse failures
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Wrap `JSON.parse` in a try/catch and route failure to `onError`.
**Acceptance:** Task 56 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 58 (RED): `WsClient.send` serialises outbound frames and rejects when not OPEN
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test for the behavior: calling `send({ type: 'cancel', message_id: 'm1' })` on a stub whose `readyState` is OPEN invokes `socket.send` with the JSON-stringified frame; calling `send` while readyState is CONNECTING throws or rejects with a recognisable "not connected" error.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 59 (GREEN): Implement `send`
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Implement per Task 58.
**Acceptance:** Task 58 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 60 (RED): `WsClient` `onClose` event is forwarded
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test that registers `onClose`, dispatches a synthetic `close` event on the stub, and asserts the handler ran with the close event's `code` and `reason`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 61 (GREEN): Wire `onClose`
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Implement per Task 60.
**Acceptance:** Task 60 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 62 (RED): `WsClient` socket `error` event is forwarded to `onError`
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test that registers `onError`, dispatches a synthetic `error` event on the stub, and asserts `onError` received a recognisable transport-error reason.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 63 (GREEN): Wire socket `error` → `onError`
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Implement per Task 62.
**Acceptance:** Task 62 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

#### Task 64 (RED): `WsClient.close()` suppresses subsequent handler invocations
**Files:** `apps/web/__tests__/lib/ws-client.test.ts`
**What to do:** Failing test for the behavior: after `close()`, dispatching a `message` event does not invoke `onFrame`; dispatching a `close` event does not invoke `onClose`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts` reports the new failure.

#### Task 65 (GREEN): Implement handler suppression after close
**Files:** `apps/web/lib/ws-client.ts`
**What to do:** Set a closed flag in `close()` and guard each dispatcher.
**Acceptance:** Task 64 passes.
**Verify:** `pnpm --filter @argus/web test -- ws-client.test.ts`.

---

### Phase 6: `MessageStream` component

#### Task 66 (RED): Cancel button visible while streaming, hidden after `end`
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that renders `MessageStream` with a stubbed `wsClient` prop, simulates inbound `start` then `token`, asserts a button with accessible name "Cancel" is present; then simulates `end` and asserts it is no longer present.
**Acceptance:** Test runs and fails because the component is missing.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the expected failure.

#### Task 67 (GREEN): Implement `MessageStream` shell + cancel button visibility
**Files:** `apps/web/components/chat/MessageStream.tsx`, `apps/web/components/chat/MessageComposer.tsx`, `apps/web/components/chat/MessageList.tsx`
**What to do:** Wire the reducer to the injected `wsClient` (calling `onFrame` to dispatch frames); render messages via `MessageList`; show the Cancel button when the streaming pointer is non-null. Create minimal `MessageComposer` and `MessageList` stubs to satisfy the render path.
**Acceptance:** Task 66 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 68 (RED): Cancel click sends a `cancel` frame
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that triggers a streaming state, clicks Cancel, and asserts the stubbed `wsClient.send` was called with a `cancel` frame carrying the active `message_id`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 69 (GREEN): Wire Cancel click → `send`
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Implement per Task 68.
**Acceptance:** Task 68 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 70 (RED): Composer disabled while streaming, re-enabled on terminal frame
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that submits via the composer, simulates `start`, asserts the input and send button are disabled; then simulates `end` and asserts they become enabled.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 71 (GREEN): Pass `composerDisabled` to `MessageComposer`
**Files:** `apps/web/components/chat/MessageStream.tsx`, `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Wire the reducer's composer-lock slot into `MessageComposer`'s `disabled` prop.
**Acceptance:** Task 70 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 72 (RED): Composer submit sends a `send` frame
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that types "hello" into the composer, clicks Send, and asserts `wsClient.send` was called with a `send` frame whose `text` is "hello"; also asserts a user-role message bubble with content "hello" appears in the rendered output (optimistic local id).
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 73 (GREEN): Wire composer submit
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Dispatch `composer-submitted` to the reducer and call `wsClient.send` with the `send` frame.
**Acceptance:** Task 72 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 74 (RED): Retry button visible on failed turn; click resends without duplicate user bubble
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that submits "hello", simulates `start` then `error`, asserts a button with accessible name "Retry" is on the failed assistant message; counts user bubbles before retry (1), clicks Retry, asserts `wsClient.send` was called with a new `send` frame carrying "hello" and the user-bubble count remains 1.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 75 (GREEN): Wire retry button
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Render a Retry button on assistant messages with status `failed`; on click dispatch the reducer's `retry` action and call `wsClient.send` with the recovered text.
**Acceptance:** Task 74 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 76 (RED): Active provider+model label on completed assistant turn
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that simulates `start` with `provider="openai"`, `model="gpt-4"`, then `end`, and asserts the rendered output for the completed assistant message contains accessible text mentioning both "openai" and "gpt-4".
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 77 (GREEN): Render provider+model label
**Files:** `apps/web/components/chat/MessageList.tsx`
**What to do:** Add the provider+model label to assistant message rendering.
**Acceptance:** Task 76 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 78 (RED): `OmittedIndicator` rendered when `omittedCount > 0`
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that initialises with 20 messages and `omittedCount: 5` (via the `init` action's payload) and asserts the rendered output contains accessible text mentioning "5 earlier messages omitted".
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 79 (GREEN): Mount `OmittedIndicator` above message list
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Render `OmittedIndicator` reading from the reducer's omitted-count slot.
**Acceptance:** Task 78 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 80 (RED): "Interrupted" marker on restored failed-disconnect messages
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that initialises with one assistant message having `status: 'failed'` and `error_code: 'client_disconnected'`; asserts the rendered output mentions "interrupted" and shows a Retry button on that message.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 81 (GREEN): Render "interrupted" marker for `client_disconnected`
**Files:** `apps/web/components/chat/MessageList.tsx`, `apps/web/components/chat/MessageStream.tsx`
**What to do:** Add the marker text for assistant messages with `status === 'failed' && error_code === 'client_disconnected'` and ensure the Retry button renders.
**Acceptance:** Task 80 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 82 (RED): No-providers terminal-error banner with README link
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that simulates an `error` frame with `error_code: 'no_providers_available'` arriving before any `start`; asserts the rendered output contains accessible text mentioning "no providers available" plus a link whose `href` includes "README".
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 83 (GREEN): Render terminal-error banner
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Read the reducer's terminal-error slot and render the banner with a deep link to the README provider-setup section.
**Acceptance:** Task 82 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

#### Task 84 (RED): On first `start` for a null-id conversation, `router.replace('/chat/<id>')` is called
**Files:** `apps/web/__tests__/components/chat/MessageStream.test.tsx`
**What to do:** Failing test that renders `MessageStream` with `conversationId={null}`, mocks `useRouter`, simulates a composer submit then an inbound `start` with `conversation_id: 'c-new'`, and asserts `router.replace` was called with `/chat/c-new`.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx` reports the new failure.

#### Task 85 (GREEN): Implement null-id `router.replace`
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** When `conversationId` prop is null and the first `start` frame arrives carrying `conversation_id`, call `router.replace('/chat/${conversation_id}')` and follow with `router.refresh()` so the sidebar picks up the new conversation in the next render.
**Acceptance:** Task 84 passes.
**Verify:** `pnpm --filter @argus/web test -- MessageStream.test.tsx`.

---

### Phase 7: Pages — login

#### Task 86: [non-TDD — page scaffolding] Create the auth route-group layout and the empty login page file
**Files:** `apps/web/app/(auth)/layout.tsx`, `apps/web/app/(auth)/login/page.tsx`
**What to do:** Create the layout (centered card, no nav). Create the login page as a client component (`'use client'`) that renders the form skeleton: email input, password input, submit button — no submit handler yet.
**Acceptance:** `pnpm --filter @argus/web build` exits 0 and the build manifest lists `/login`.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 87 (RED): Login form validation — empty email or password disables submit (or surfaces inline validation)
**Files:** `apps/web/__tests__/app/(auth)/login.test.tsx`
**What to do:** Failing test that renders the login page, leaves the email blank, clicks Submit, and asserts an inline validation message (e.g. "Email is required") is visible OR the submit button is disabled — pick whichever pattern the worker prefers but commit to one.
**Acceptance:** Test runs and fails because the validation is not wired.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx` reports the expected failure.

#### Task 88 (GREEN): Implement login-form validation
**Files:** `apps/web/app/(auth)/login/page.tsx`
**What to do:** Implement the validation per Task 87.
**Acceptance:** Task 87 passes.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx`.

#### Task 89 (RED): Login submit on success → `router.push('/chat')`
**Files:** `apps/web/__tests__/app/(auth)/login.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to resolve with a valid `LoginResponse`, mocks `useRouter`, types valid credentials, clicks Submit, and asserts `router.push('/chat')` was called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx` reports the new failure.

#### Task 90 (GREEN): Wire login submit → POST + push
**Files:** `apps/web/app/(auth)/login/page.tsx`
**What to do:** On submit, call `client-api-fetch` against `/api/auth/login`; on success call `router.push('/chat')`.
**Acceptance:** Task 89 passes.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx`.

#### Task 91 (RED): Login 401 → "Invalid email or password" inline error
**Files:** `apps/web/__tests__/app/(auth)/login.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to throw `AuthError` (status 401), submits, and asserts the rendered output contains "Invalid email or password" and `router.push` was NOT called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx` reports the new failure.

#### Task 92 (GREEN): Handle 401
**Files:** `apps/web/app/(auth)/login/page.tsx`
**What to do:** Catch `AuthError` and render the inline error.
**Acceptance:** Task 91 passes.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx`.

#### Task 93 (RED): Login 5xx → generic "Something went wrong, please try again"
**Files:** `apps/web/__tests__/app/(auth)/login.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to throw `ApiError` with status 500, submits, and asserts the generic error text is visible.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx` reports the new failure.

#### Task 94 (GREEN): Handle 5xx
**Files:** `apps/web/app/(auth)/login/page.tsx`
**What to do:** Catch `ApiError` with status ≥ 500 and render the generic error.
**Acceptance:** Task 93 passes.
**Verify:** `pnpm --filter @argus/web test -- login.test.tsx`.

---

### Phase 8: Pages — signup

#### Task 95: [non-TDD — page scaffolding] Create the empty signup page file
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** Create the signup page as `'use client'` with form skeleton: email, password, confirm-password, submit — no handler.
**Acceptance:** `pnpm --filter @argus/web build` exits 0 and the build manifest lists `/signup`.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 96 (RED): Signup confirm-password mismatch shows inline error
**Files:** `apps/web/__tests__/app/(auth)/signup.test.tsx`
**What to do:** Failing test that types mismatching passwords, clicks Submit, asserts an inline error mentioning "Passwords do not match" and asserts no fetch was called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx` reports the expected failure.

#### Task 97 (GREEN): Implement password-match validation
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** Implement per Task 96.
**Acceptance:** Task 96 passes.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx`.

#### Task 98 (RED): Signup success → `router.push('/chat')`
**Files:** `apps/web/__tests__/app/(auth)/signup.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to resolve with `SignupResponse`, submits, and asserts `router.push('/chat')` was called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx` reports the new failure.

#### Task 99 (GREEN): Wire signup submit
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** POST to `/api/auth/signup` via `client-api-fetch`; on success push to `/chat`.
**Acceptance:** Task 98 passes.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx`.

#### Task 100 (RED): Signup 409 → "An account with that email already exists"
**Files:** `apps/web/__tests__/app/(auth)/signup.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to throw `ApiError` with status 409, submits, asserts the duplicate-email message is visible and `router.push` was NOT called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx` reports the new failure.

#### Task 101 (GREEN): Handle 409
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** Implement per Task 100.
**Acceptance:** Task 100 passes.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx`.

#### Task 102 (RED): Signup 400 → render the server-provided validation message
**Files:** `apps/web/__tests__/app/(auth)/signup.test.tsx`
**What to do:** Failing test that mocks `client-api-fetch` to throw `ApiError` with status 400 and body `{ message: 'Email must be a valid address' }`, submits, asserts the body's `message` is rendered inline.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx` reports the new failure.

#### Task 103 (GREEN): Handle 400 with server-provided message
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** Implement per Task 102.
**Acceptance:** Task 102 passes.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx`.

#### Task 104 (RED): Signup 5xx → generic error
**Files:** `apps/web/__tests__/app/(auth)/signup.test.tsx`
**What to do:** Failing test analogous to Task 93 for signup.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx` reports the new failure.

#### Task 105 (GREEN): Handle signup 5xx
**Files:** `apps/web/app/(auth)/signup/page.tsx`
**What to do:** Implement per Task 104.
**Acceptance:** Task 104 passes.
**Verify:** `pnpm --filter @argus/web test -- signup.test.tsx`.

---

### Phase 9: Pages — chat layout + chat pages

#### Task 106: [non-TDD — page scaffolding] Create empty `app/chat/layout.tsx` server component
**Files:** `apps/web/app/chat/layout.tsx`
**What to do:** Create a minimal server-component layout that just renders `{children}` — no auth gate yet, no sidebar.
**Acceptance:** `pnpm --filter @argus/web build` exits 0.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 107 (RED): Chat layout redirects to `/login` when session is missing
**Files:** `apps/web/__tests__/app/chat/layout.test.tsx`
**What to do:** Failing test that mocks `server-session` to return `null` and `next/navigation`'s `redirect`, renders the layout, and asserts `redirect('/login')` was called.
**Acceptance:** Test runs and fails because the layout doesn't call `server-session`.
**Verify:** `pnpm --filter @argus/web test -- layout.test.tsx` reports the expected failure.

#### Task 108 (GREEN): Wire the auth gate
**Files:** `apps/web/app/chat/layout.tsx`
**What to do:** Mark the layout as an `async` Server Component. `await server-session()`; if `null`, call `redirect('/login')` from `next/navigation`. (Server Components in Next 15 must `await` async dependencies — `server-session` reads `await cookies()` under the hood.)
**Acceptance:** Task 107 passes.
**Verify:** `pnpm --filter @argus/web test -- layout.test.tsx`.

#### Task 109 (RED): Chat layout renders sidebar with conversations from `listConversations`
**Files:** `apps/web/__tests__/app/chat/layout.test.tsx`
**What to do:** Failing test that mocks `server-session` to return a user, mocks `conversations-api.listConversations` to resolve with two conversations, renders the layout, and asserts both conversation titles are visible plus a Logout control.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- layout.test.tsx` reports the new failure.

#### Task 110 (GREEN): Render sidebar
**Files:** `apps/web/app/chat/layout.tsx`
**What to do:** Within the `async` Server Component, `await listConversations()`, pass the resolved array as a prop to `<ConversationList>`, render `<LogoutButton>` and `{children}`.
**Acceptance:** Task 109 passes.
**Verify:** `pnpm --filter @argus/web test -- layout.test.tsx`.

#### Task 111: [non-TDD — page composition] Create `app/chat/page.tsx`
**Files:** `apps/web/app/chat/page.tsx`
**What to do:** Server component that renders `<MessageStream conversationId={null} initialMessages={[]} omittedCount={0} />`.
**Acceptance:** `pnpm --filter @argus/web build` exits 0 and the build manifest lists `/chat`.
**Verify:** `pnpm --filter @argus/web build`.

#### Task 112 (RED): `/chat/[conversationId]` page fetches history and passes to `MessageStream`
**Files:** `apps/web/__tests__/app/chat/[conversationId]/page.test.tsx`
**What to do:** Failing test that mocks `conversations-api.getMessages` to resolve with `{ messages: [one user, one assistant], omitted_count: 2 }`, renders the page with `params` shaped as `Promise.resolve({ conversationId: 'c1' })` (**Next 15: Server Component `params` is now `Promise<...>`** — tests must pass the prop as a resolved Promise, not a plain object), and asserts both messages and the "2 earlier messages omitted" indicator are visible. Because the page is an `async` Server Component, the test must `await` the page invocation (or rely on RTL's `findBy*` queries) before asserting on the rendered tree.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- "[conversationId]/page.test.tsx"` reports the expected failure.

#### Task 113 (GREEN): Implement `/chat/[conversationId]/page.tsx`
**Files:** `apps/web/app/chat/[conversationId]/page.tsx`
**What to do:** `async` Server Component whose `params` prop is typed as `Promise<{ conversationId: string }>` (**Next 15 breaking change**). The page must `await params` before destructuring `conversationId`, then `await getMessages(conversationId)`, and render `<MessageStream conversationId={conversationId} initialMessages={messages} omittedCount={omitted_count} />`. Do **not** read `params.conversationId` synchronously — that pattern works in Next 14 and silently breaks at runtime in Next 15.
**Acceptance:** Task 112 passes.
**Verify:** `pnpm --filter @argus/web test -- "[conversationId]/page.test.tsx"`.

#### Task 114 (RED): `/chat/[conversationId]` triggers `notFound()` on 404 from the API
**Files:** `apps/web/__tests__/app/chat/[conversationId]/page.test.tsx`
**What to do:** Failing test that mocks `getMessages` to throw `ApiError` with status 404, mocks `next/navigation`'s `notFound`, renders the page with `params` as a resolved Promise (per Next 15 — see Task 112), `await`s the page invocation, and asserts `notFound()` was called.
**Acceptance:** Test runs and fails.
**Verify:** `pnpm --filter @argus/web test -- "[conversationId]/page.test.tsx"` reports the new failure.

#### Task 115 (GREEN): Map 404 → `notFound()`
**Files:** `apps/web/app/chat/[conversationId]/page.tsx`
**What to do:** Wrap the `await getMessages(conversationId)` call (after `await params` has resolved — see Task 113) in a try/catch; on `ApiError` with status 404 call `notFound()` from `next/navigation`. Re-throw other errors to let Next's error boundary handle them.
**Acceptance:** Task 114 passes.
**Verify:** `pnpm --filter @argus/web test -- "[conversationId]/page.test.tsx"`.

---

### Phase 10: Final smoke

#### Task 116: [non-TDD — local compose smoke] End-to-end happy-path smoke
**Files:** none (operational checklist; capture results in PR description)
**What to do:** With the compose stack running (`docker compose up`) and `MOCK_PROVIDER=true`, reproduce these steps locally and confirm each completes without console errors or DOM warnings:
1. Sign up with a fresh email → land on `/chat`.
2. Type "hello" → stream completes, provider+model label appears.
3. Reload the page → history visible.
4. Click sidebar to start a second conversation → send a message there.
5. Cancel mid-stream → "canceled" marker visible, partial content preserved.
6. Force a turn to fail (stop the api container briefly during a stream) → Retry button appears, click it, turn succeeds.
7. Click Logout → land on `/login`.
**Acceptance:** Reproducing the seven steps locally produces the expected UI state at each step. Screenshots are optional supporting evidence for the PR; acceptance is the local reproduction, not the artifact.
**Verify:** Manual checklist captured in the PR description by `pr-writer`.

---

## Quality Gates
- typecheck: `pnpm --filter @argus/web typecheck`
- lint: `pnpm --filter @argus/web lint`
- test: `pnpm --filter @argus/web test`
- build: `pnpm --filter @argus/web build`
- root-level (catches workspace drift): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

## Dependencies

- **`packages/contracts`** — Tasks 1A–1F in this LLD author the WS frame schemas and the auth + conversation DTOs needed by the frontend; backend-api LLD adds the OTel attribute and projection-row schemas (frontend does not depend on those). Both LLDs MUST agree on the export names listed at the top of this file. Any name change must be coordinated.
- **`apps/api`** — must expose `/auth/login`, `/auth/signup`, `/auth/logout`, `/auth/session`, `/conversations`, `/conversations/:id/messages`, and the WS Gateway at `/chat`. Owned by the backend-api LLD; needed live for Task 116's smoke.

## Open Questions (LLD-level)

- **Session cookie name.** Assumed `argus_session`. Backend-api LLD to confirm; if different, update `server-session.ts`.
- **`omitted_count` transport.** Assumed the API returns `{ messages, omitted_count }` on `GET /conversations/:id/messages` (HLD D6 makes the indicator UI explicit). Backend LLD to confirm.
- **`conversation_id` minting timing.** Assumed the server mints it on the first user message arriving on a null-conversation socket and emits it on the first `start` frame. Tasks 84–85 handle the mid-stream URL replace. If backend prefers a REST pre-flight to create the conversation before opening the WS, Task 111 changes shape — flagged to backend-api LLD.
- **WS host vs Next dev/prod host.** Assumed same-origin proxy through Next.js so the session cookie attaches automatically. If the WS host differs (`ws.api.local:4000`), `ws-client.ts` needs an explicit auth scheme — not currently planned.
- **Retry of `client_disconnected` messages restored from history.** Reducer's retry context comes from the live session; a reloaded failed message has no in-memory retry context. Assumed the component derives the retry text from the immediately preceding user message in the loaded history (an effect equivalent to the live retry-context lookup, but read off the message log itself). Worker implements this in Task 75 if the test demands it; otherwise Retry on a restored failed message uses the same log-walk.
