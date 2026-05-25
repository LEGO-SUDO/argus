## 0. Format Violations

Hard rejection issues:

> ```  
> apps/api/
>   src/
> ...
> ```

This is a fenced code block. The rejection criteria says **ANY code blocks** are disallowed. Convert the file tree to prose bullets or an unfenced list.

> `packages/sdk` — exports `chat.stream({ messages, conversationId, turnIndex, userId, signal }) → AsyncIterable<{ token } | { done, providerMeta }>` ...

This is effectively an API signature plus inline structural types. Replace with prose: “The API consumes the SDK chat stream surface, which yields token events and a terminal done event.”

> `hashPassword(plain: string): Promise<string>`

> `verifyPassword(hash: string, plain: string): Promise<boolean>`

> `chat.stream({ messages, conversationId, turnIndex, userId, signal }) → AsyncIterable...`

Function/type signatures are present in the plan. Replace with prose I/O descriptions.

> Write a failing test asserting `hashPassword(plain)` produces an Argon2id-formatted string starting with `$argon2id$` and that two calls on the same plaintext yield different outputs...

This is borderline over-specified test assertion detail. The LLD should name behavior, not spell out exact assertions. Keep the acceptance-level behavior, move assertion mechanics to the test.

> Write a failing test that calling `mintMessageId()` 1000 times produces 1000 distinct string values matching a UUID v4...

This is detailed test implementation. Keep “message IDs are unique and UUID v4 formatted”; leave sample size to the test.

> Task 55: [non-TDD — NestJS WS Gateway registration glue] Wire `ChatGateway`

This task is far too large for the stated bite-size requirement. It combines gateway registration, auth, frame validation, send handling, orchestration lifecycle, cancel routing, disconnect cleanup, and manual smoke testing. Split into smaller non-TDD tasks or add RED/GREEN tests around gateway behavior.

> Task 19: [non-TDD — Nest module wiring] AuthModule + controller scaffolding

Too large. It covers module providers, three routes, DTO parsing, cookie setting/clearing, and error mapping. Split controller route behavior into RED/GREEN tests or smaller non-TDD wiring tasks.

> Task 28: [non-TDD — Nest module + REST controller wiring] ConversationsModule

Too large. It wires module, five endpoints, auth guard behavior, ownership behavior, and manual curl verification. Split by controller surface or add RED/GREEN controller tests.

## 1. Tasks Too Vague To Execute

> `fixtures/prisma-test-client.ts # spins ephemeral DB or uses in-memory mock`

Ambiguous. The builder needs to know whether tests use a real Postgres test DB, Prisma transaction rollback, Testcontainers, SQLite, or mocks. This affects almost every repository/service test.

> Implement `hashPassword` ... with library-recommended memory/time/parallelism defaults.

“Library-recommended defaults” is vague and may change by argon2 package version. Either explicitly accept package defaults or pin parameters.

> persists only the token's hash in `sessions.token_hash`

Hash algorithm is unspecified. Is this SHA-256, HMAC-SHA256 with app secret, Argon2, or something else? Session lookup requires deterministic hashing, so this must be explicit.

> cryptographically random opaque token

Length/encoding are unspecified. The builder needs a token size, for example 32 random bytes encoded base64url/hex.

> session cookie name + serialization constants

Cookie settings are scattered between open questions and Task 19. The builder needs one canonical source for name, max-age, sameSite, secure behavior, path, and clearing behavior.

> Implement `resolveWsUser(handshakeHeaders)`

The shape of `handshakeHeaders` is unclear. Node HTTP headers can be `string | string[] | undefined`; Socket.IO handshake headers have their own shape. Specify expected input shape.

> `MessagesRepository` with user-scoped reads

`MessagesRepository` appears only at Task 26/27 and under `apps/api/src/conversations/messages.repository.ts`, but it is absent from the initial file tree. Add it to file structure.

## 2. Missing Acceptance Criteria

Most tasks have acceptance criteria, but some criteria are not observable enough:

> Task 40 ... Only after the transaction commits does it return — the caller invokes the SDK afterward.

Acceptance does not verify “SDK afterward” because Task 40 says caller invokes SDK afterward, while Task 39 says mocked SDK records call order. The design has a mismatch: `startTurn` either calls SDK or it does not. Clarify ownership.

> Task 46 ... The `errorCode` is stored on `messages` if the column exists, otherwise only used by the WS frame layer...

Acceptance allows two incompatible implementations. The builder needs one schema contract. If infra LLD owns the column, this LLD should depend on that decision explicitly.

> Task 18 ... Register `cookie-parser` middleware.

Acceptance only checks seed boot behavior. It does not observe `cookie-parser` registration.

## 3. Test Gaps

Missing or weak tests:

- No controller tests for `/auth/signup`, `/auth/login`, `/auth/logout` cookie behavior and error mapping. Task 19 is manual only despite security-sensitive behavior.
- No REST guard integration test proving `SessionGuard` works with cookie-parser and real Nest requests.
- No test for session expiry. `findUserBySessionToken` should reject expired sessions.
- No test that plaintext session tokens are never stored.
- No test for logout idempotency/no-op on unknown token.
- No test for seed defaults and env override behavior.
- No test that `seedDemoUser` does not rehash/update an existing demo user when env password changes.
- No controller tests for conversation ownership; manual curl is not enough for cross-user authorization.
- No test that `ChatService.startTurn` verifies the conversation belongs to `userId` before inserting messages.
- No test for duplicate/concurrent `startTurn` transaction behavior or idempotency if the client retries.
- No gateway-level tests for invalid inbound WS frames, unauthenticated connection rejection, and cancel for unknown `messageId`.
- No test that `SeqCounterRegistry.release` is called on terminal stream paths.
- No test that `StreamOrchestrator` releases counters after complete/cancel/fail/disconnect.
- No test for SDK stream throwing after partial tokens; only pre-first-token failure is covered.
- No test that `inferences` placeholder is not mutated by `completeTurn`, `cancelTurn`, and `failTurn` beyond “not touched” assertions, which should check timestamp/version or exact row equality.

## 4. File-Path Errors

> `apps/api/src/common/authorization.filter.ts # user-scoped query helper / repo factory`

But Task 26 tests repository methods directly and no task implements `authorization.filter.ts`. Either add an implementation task or remove the file.

> `apps/api/test/common/authorization.filter.test.ts`

The test name suggests a filter helper, but the task describes reflective repository authorization coverage. Rename to match purpose or add the missing filter abstraction.

> `apps/api/src/conversations/messages.repository.ts`

This file is not listed in the initial file structure under `conversations/`. Add it there.

> `apps/api/src/app.module.ts`

Listed and referenced in Task 18, but no task wires `AuthModule`, `ConversationsModule`, and `ChatModule` into `AppModule` explicitly except partially. Add explicit root-module acceptance.

> `packages/contracts` exports `WsFrameSchema`

The LLD imports both inbound and outbound frame schemas but repeatedly references one `WsFrameSchema`. If contracts has separate inbound/outbound schemas, the path/name will be wrong. Clarify exact exports.

## 5. Hand-Off Risk

- The design says ChatService is the “sole writer of `messages.status`,” but StreamOrchestrator directly drives status transitions through ChatService. Good, but Gateway must not update status. State that explicitly in Task 55.
- `startTurn` ownership validation is underspecified. Without checking `conversation.user_id`, a user may write messages into another user’s conversation.
- The `startTurn`/SDK boundary is inconsistent. Scope says chat service consumes SDK, Task 39 says mocked SDK records call order, but Task 40 says caller invokes SDK afterward. Pick one owner.
- Session token hashing must be deterministic for lookup. If the builder uses Argon2 for session tokens, lookup becomes impossible without scanning rows.
- Cookie parsing is duplicated between REST guard and WS helper. The LLD should require shared parsing behavior or consistent tests for encoded cookie values.
- Reflective “every public method” authorization tests can become brittle because class methods include constructor/private-ish helpers depending on implementation. An explicit public repository method registry with a coverage assertion is safer.
- The Redpanda/outbox invariant is important, but the LLD does not define required `inferences` columns beyond status and token counts. Builder may invent fields inconsistent with infra LLD.
- Manual-only gateway/controller verification is high risk for auth and authorization behavior.

## 6. Quality Score

**5/10**

The plan is thorough and mostly sequenced, but it violates the requested LLD format, has several oversized tasks, leaves important security details ambiguous, and has a real ownership mismatch around `ChatService.startTurn` versus SDK orchestration. It needs revision before handing to a builder.
