## 0. Format Violations

Hard rejection issues:

- `"Reviewer (cross-model — REQUIRED different lineage) ... framing: see ~/.claude/skills/oh/prompts/builder-addendum.md"`

  This references a forbidden path for this review context. Remove the path reference or inline the needed reviewer instruction in prose. Do not require the builder/reviewer to read under `~/.claude/`.

- `"Tester ... framing: test-writer agent assembles the test plan; codex designs the actual tests via the wrapper"`

  This is orchestration, not frontend-web implementation. Either remove it from the builder LLD or move it to a separate review/test workflow doc.

- `"Add a failing test asserting that ..."` repeated across most RED tasks, with exact assertions and field expectations.

  Example:

  > `Add a failing test asserting that dispatching a start frame ... produces state where streaming is a new assistant-role message with id equal to the frame's message_id, empty content, status streaming, and provider/model labels recorded.`

  This is close to detailed test assertion prose. It is acceptable if your process allows behavioral test specs, but under the stated rejection rule, these should be softened to behavior-level intent. The test file should own exact assertions.

- Task 47, 48, 50, 52, 55 are testable user-facing behavior but are marked non-TDD.

  Example:

  > `Task 47: [non-TDD — Next.js page scaffolding] Build login page`

  Login/signup/auth redirect/chat route behavior is testable. Split into RED/GREEN task pairs or explicitly justify why these are manual-only integration tasks. Right now they violate “Testable behavior NOT structured as RED → GREEN.”

- Several tasks are too large for “bite-sized >5 minutes.”

  Examples:

  > `Task 1: [non-TDD — Next.js app scaffolding] Initialize apps/web Next.js app`

  > `Task 47: [non-TDD — Next.js page scaffolding] Build login page`

  > `Task 50: [non-TDD — Next.js layout glue] Build auth-gated /chat layout`

  > `Task 58: [non-TDD — local compose smoke] End-to-end smoke through the full Phase A web surface`

  Split Task 1 into package scaffold, Tailwind, Next config, root layout, and build verification. Split route tasks into form rendering, API submit behavior, error rendering, and navigation behavior.

## 1. Tasks That Are Too Vague To Execute

- > `If packages/contracts is not yet available ... the frontend worker stubs the import surface against the HLD-defined frame names ... and the backend/contracts LLD reconciles on landing.`

  This is risky and underspecified. The builder needs exact temporary file paths, export names, schema names, and the removal/reconciliation process. Otherwise the frontend may invent incompatible contracts.

- > `packages/contracts ... exports the WS frame discriminated union, REST DTOs for auth + conversations, and the OTel attribute schema.`

  Missing concrete import names. Later tasks say `@contracts/ws`, but DTO modules are never named. Specify exact expected exports such as inbound schema, outbound schema, DTO type names, and message DTO shape.

- > `apps/web/lib/auth-fetch.ts — thin wrapper over fetch that forwards the session cookie`

  Ambiguous because client-side fetch forwards cookies with `credentials`, server-side fetch must manually forward cookies from `next/headers`. This helper is used from both client pages and server helpers, but those have different mechanics.

- > `next.config.mjs — minimal config; rewrites for /api/* to apps/api`

  “apps/api” is not a URL. Task 1 later says env `NEXT_PUBLIC_API_URL`. Specify rewrite destination format, default value, and whether this env var is safe as `NEXT_PUBLIC_*` or should be server-only.

- > `server-session.ts ... calls the API's /auth/session (or equivalent)`

  “or equivalent” is not executable. Pin the endpoint.

- > `getMessages(conversationId) ... computes omittedCount if the api returns it (otherwise zero)`

  The response envelope is not defined. Is it `{ messages, omitted_count }`, `{ data, omittedCount }`, or an array with metadata headers? Builder cannot type this reliably.

- > `MessageStream ... accepts a wsClient prop or factory for testability`

  Pick one. A prop instance and a factory have different lifecycle semantics and cleanup behavior.

- > `on first send, navigates to /chat/[conversationId] once the server mints the conversation id`

  The LLD does not define how the WS URL is opened for a null conversation. Does it connect to `/chat`, `/chat?conversation_id=`, or one shared endpoint with a send frame? This is central to Task 52/54.

## 2. Missing Acceptance Criteria

Most tasks have an `Acceptance` line, but several criteria are not observable enough:

- > `Task 51 ... Acceptance: Manual smoke from a Node REPL or a temporary server component`

  This is vague and leaves temporary code risk. Specify an exact command or remove the REPL acceptance and rely on typed integration tests/build.

- > `Task 49 ... with a valid cookie issued by the api, returns the user`

  Missing exact cookie name and user shape. Builder needs observable expected return fields.

- > `Task 58 ... screenshots of each major state attached to the PR`

  This depends on PR tooling and external state. Fine as release smoke, but not a builder-local acceptance criterion. Add concrete commands, seeded credentials, and expected UI markers.

## 3. Test Gaps

- No tests for login/signup forms despite rich error behavior.

  Tasks 47/48 include invalid credentials, duplicate email, validation error, success redirect, and generic 5xx handling, but no RTL tests. These are cheap and should be RED/GREEN pairs.

- No tests for `server-session.ts`.

  Cookie forwarding and null-on-invalid are high-risk. Add unit tests mocking `next/headers` and `fetch`.

- No tests for `auth-fetch.ts`.

  It is shared by auth pages and server helpers. Test 401 typed `AuthError`, JSON parsing, credentials/cookie forwarding mode, and non-JSON error handling.

- No tests for `conversations-api.ts`.

  The LLD says “thin pass-through,” but path mistakes and DTO envelope mistakes are likely. Add minimal fetch-path tests.

- No test for `ConversationList` active route derivation.

  The LLD says active highlighting comes from props, but `chat/layout.tsx` is server-side and cannot directly know `[conversationId]` from `children`. Either pass active ID from pages or make the list use `usePathname`. Test the chosen behavior.

- No tests for malformed JSON in `ws-client`.

  Task 27 covers malformed frame but not invalid JSON. Add an `onError` case for parse failure.

- No tests for WebSocket close/error events.

  The file description requires typed `onClose` and `onError`, but tests only cover validation error and close suppression. Add close event behavior.

- Reducer does not explicitly test `cancel-ack`.

  Scope includes frame name `cancel-ack`, but no RED/GREEN pair covers it. Define whether it changes UI state or is ignored.

- Reducer does not test token/message ID mismatch.

  Task 7 handles seq ordering, but not ignoring tokens for a different `message_id`.

- Retry behavior is under-tested.

  Task 38 assumes “most recent user message.” Add a test that retry on an older failed assistant turn resends the immediately preceding user message, not a later user message.

- No route-level tests for `/chat/[conversationId]` 404/notFound behavior.

  Task 55 relies on API ownership filtering and `notFound()`, but no test verifies the mapping.

## 4. File-Path Errors

- > `@contracts/*` to `packages/contracts/src/*`

  From `apps/web/tsconfig.json`, this path should likely be relative: `../../packages/contracts/src/*`. The LLD should specify the exact `paths` value.

- > `next.config.mjs — rewrites for /api/* to apps/api`

  `apps/api` is a workspace path, not a runtime destination. Use an HTTP destination from env, e.g. `${API_URL}/:path*`.

- > `apps/web/__tests__/components/MessageStream.test.tsx`

  Source file is under `apps/web/components/chat/MessageStream.tsx`, but tests do not mirror the `chat` subdirectory despite the LLD saying tests mirror source path. Either use `__tests__/components/chat/MessageStream.test.tsx` or remove the mirror claim.

- Same mismatch for:
  > `apps/web/__tests__/components/ConversationList.test.tsx`  
  > `apps/web/__tests__/components/OmittedIndicator.test.tsx`  
  > `apps/web/__tests__/components/LogoutButton.test.tsx`

  These should probably be under `__tests__/components/chat/`.

- > `@contracts/ws`

  This alias does not match `@contracts/*` to `packages/contracts/src/*` unless `packages/contracts/src/ws.ts` exists. Specify that file/export or use the actual package import convention.

## 5. Hand-Off Risk

- The LLD mixes implementation plan with cross-agent orchestration. A builder may waste time trying to satisfy reviewer/tester mechanics instead of building the app.

- The contracts dependency is too loose. The fallback stub instruction will almost certainly create drift unless exact schema/export names are pinned.

- `auth-fetch` is overloaded across client and server concerns. This should likely be split into `client-api-fetch` and `server-api-fetch`, or the LLD must specify behavior per runtime.

- `NEXT_PUBLIC_API_URL` for rewrites is questionable. Next rewrites run server-side at build/runtime config, and public env exposure may be unnecessary. Also browser requests to `/api/*` do not need `NEXT_PUBLIC_API_URL`.

- WebSocket cookie forwarding is stated as “opens the socket with cookies,” but cross-origin WS cookies require origin, SameSite, secure flags, and possibly credentials cannot be manually set. The LLD should state same-origin proxying or exact WS host assumptions.

- `MessageStream` reducer state is doing many jobs: message log, streaming state, composer lock, omitted count, terminal errors, retry metadata. This is okay, but the LLD should define the state model once so tasks do not evolve it inconsistently.

- `composer-submitted` says append a local optimistic user message, but the ID source is not specified. The builder may use random IDs, timestamps, or omit IDs. Tests should define stability needs without dictating implementation.

- Task 38 says retry dispatches `composer-submitted`, which appends another user message. That may duplicate the previous user text in the transcript. If retry should create a new turn, say so. If it should reuse the prior turn without duplication, change the reducer action.

- `MessageStream` default WS factory is underspecified. It needs URL construction rules for existing vs new conversation, lifecycle cleanup, and dependency behavior when `conversationId` changes.

- `ConversationList` is client component with server-fetched props, but after sending a first message and `router.replace`, the sidebar may not refresh automatically. Task 52 says “appears in sidebar list on next navigation,” but the UX may look stale. Decide whether to call `router.refresh()` after first `start`.

- Manual smoke tasks require a running API and compose stack, but seeded users, env vars, and failure-forcing instructions are missing.

## 6. Quality Score

5/10.

The LLD has strong coverage and a useful RED/GREEN progression for reducer, WebSocket, and core chat components. It is not ready to hand off because the contract imports, runtime config, auth fetch split, route behavior, and several page-level tests are underspecified. The biggest required revision is to tighten the executable interfaces and convert testable page behavior into RED/GREEN pairs.
