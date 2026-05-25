---
phase: lld
status: APPROVED
slug: argus
scope: phase-a
domain: backend-api
builder: backend-api-worker
created: 2026-05-23
updated: 2026-05-23
---

# LLD: backend-api — Argus Phase A

Phase A scope for `apps/api`: auth (REST + opaque session cookie + Argon2id password hashing + HMAC-SHA256 deterministic session-token hashing), idempotent demo-user seed on boot, user-scoped conversation CRUD, the WS chat gateway (cookie-authed handshake, server-minted `message_id`, frame envelope per HLD D2), and the chat service which is the **sole writer of `messages.status`** and the synchronous owner of the outbox `inferences` placeholder row (HLD D1). The `StreamOrchestrator` (not `ChatService`) is the sole caller of the SDK chat stream surface — `ChatService.startTurn` only performs outbox writes inside a single Prisma transaction and returns. The gateway never updates `messages.status`.

Out of this LLD (covered elsewhere):
- Prisma schema and migrations — `lld-backend-infra.md` / `packages/db` LLD. This LLD declares its required columns explicitly under §Cross-LLD Dependencies.
- `packages/sdk` implementation (router, providers, context, cost, OTel) — its own LLD. This LLD only consumes the SDK chat stream surface (input is a message list plus identifiers and an abort signal; output is an async iterable of token events terminated by a done event).
- `packages/contracts` WS frame zod schemas and REST DTO schemas — its own LLD. This LLD only imports those schemas and types; required exports are listed under §Cross-LLD Dependencies.
- `apps/workers` Redpanda projection consumer — `lld-backend-infra.md`.
- `/console` reads, BullMQ jobs, replay engine — Phase B.

## Builder
**agent:** backend-api-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** see `~/.claude/skills/oh/prompts/builder-addendum.md`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the actual tests via the wrapper

## File Structure

- `apps/api/src/main.ts` — NestJS bootstrap; preflight DB ping, runs seed before listen, registers cookie-parser middleware.
- `apps/api/src/app.module.ts` — root module that imports `AuthModule`, `ConversationsModule`, `ChatModule`, and a tiny `BootstrapModule` exposing `PrismaService` and `seedDemoUser`.
- `apps/api/src/bootstrap/seed.ts` — idempotent demo-user seed.
- `apps/api/src/common/prisma.service.ts` — `PrismaClient` lifecycle wrapper around the client exported from `@argus/db`.
- `apps/api/src/common/session-cookie.ts` — single canonical source of session cookie config (name, max-age, sameSite, secure flag, path, set/clear helpers).
- `apps/api/src/auth/auth.module.ts` — Nest module wiring auth providers.
- `apps/api/src/auth/auth.controller.ts` — REST endpoints for signup, login, logout.
- `apps/api/src/auth/auth.service.ts` — signup, login, logout, find-user-by-session orchestration.
- `apps/api/src/auth/password.ts` — Argon2id hash/verify helpers.
- `apps/api/src/auth/session-token.ts` — opaque session token generator and deterministic HMAC-SHA256 hasher keyed by `SESSION_SECRET`.
- `apps/api/src/auth/session.repository.ts` — Prisma access for the `sessions` table.
- `apps/api/src/auth/session.guard.ts` — REST guard that resolves cookie to `user_id`.
- `apps/api/src/auth/ws-session.ts` — WS handshake cookie resolver; shares the cookie-parser util with the REST guard.
- `apps/api/src/auth/cookie-parser.util.ts` — single cookie-header parser used by both the REST guard and the WS resolver to guarantee parity.
- `apps/api/src/auth/errors.ts` — `DuplicateEmailError`, `InvalidCredentialsError`.
- `apps/api/src/auth/dto/signup.dto.ts` — zod-derived request schema for signup.
- `apps/api/src/auth/dto/login.dto.ts` — zod-derived request schema for login.
- `apps/api/src/conversations/conversations.module.ts` — Nest module wiring conversation providers.
- `apps/api/src/conversations/conversations.controller.ts` — REST endpoints for list, get, create, rename, delete, list-messages.
- `apps/api/src/conversations/conversations.repository.ts` — user-scoped Prisma access for conversations.
- `apps/api/src/conversations/messages.repository.ts` — user-scoped Prisma access for messages (read paths only; chat service writes).
- `apps/api/src/conversations/dto/create-conversation.dto.ts` — zod-derived create payload schema.
- `apps/api/src/conversations/dto/update-conversation.dto.ts` — zod-derived rename payload schema.
- `apps/api/src/chat/chat.module.ts` — Nest module wiring chat providers.
- `apps/api/src/chat/chat.gateway.ts` — WS gateway with cookie auth on handshake, frame routing, and per-client orchestrator registry.
- `apps/api/src/chat/chat.service.ts` — outbox writer; owns `mintMessageId`, `startTurn`, `completeTurn`, `cancelTurn`, `failTurn`; never calls the SDK.
- `apps/api/src/chat/stream-orchestrator.ts` — sole caller of the SDK stream; emits frames; calls back into `ChatService` for terminal status writes.
- `apps/api/src/chat/frame-builder.ts` — pure helpers building start, token, end, error, cancel-ack frames against the contracts schemas.
- `apps/api/src/chat/seq-counter.ts` — per-message monotonic seq source plus a registry indexed by `message_id` with a `release` cleanup hook.

- `apps/api/test/auth/password.test.ts` — Argon2id hash/verify behavior.
- `apps/api/test/auth/session-token.test.ts` — opaque token generation and deterministic HMAC hashing.
- `apps/api/test/auth/auth.service.test.ts` — signup, login, logout, session expiry, plaintext-never-stored.
- `apps/api/test/auth/auth.controller.test.ts` — controller-level signup/login/logout cookie behavior and error mapping.
- `apps/api/test/auth/session.guard.test.ts` — REST guard accept/reject paths including cookie-parser integration.
- `apps/api/test/auth/ws-session.test.ts` — WS handshake resolver parity with the REST guard.
- `apps/api/test/bootstrap/seed.test.ts` — idempotency, env override, no-rehash on re-run.
- `apps/api/test/conversations/conversations.repository.test.ts` — user-scoped CRUD.
- `apps/api/test/conversations/conversations.controller.test.ts` — cross-user authorization at the controller layer.
- `apps/api/test/chat/frame-builder.test.ts` — envelope shapes round-trip through the contracts schemas.
- `apps/api/test/chat/seq-counter.test.ts` — counter and registry semantics including `release`.
- `apps/api/test/chat/chat.service.test.ts` — `startTurn` ownership validation, transactional outbox, terminal status writes.
- `apps/api/test/chat/stream-orchestrator.test.ts` — happy, cancel, disconnect, pre-token-fail, post-token-fail paths; counter release on every terminal path.
- `apps/api/test/chat/chat.gateway.test.ts` — handshake auth, frame validation, send/cancel/disconnect handlers.
- `apps/api/test/common/repository-authorization.test.ts` — explicit registry-driven cross-user rejection across every public repository read method.
- `apps/api/test/fixtures/prisma-test-client.ts` — shared helper that uses `@quramy/jest-prisma` to wrap each test in a Postgres transaction that rolls back at teardown. All repository, service, and seed tests import this fixture and use the live Prisma client against the test database. No mocking of Prisma anywhere in this LLD.

## Cross-LLD Dependencies

### From `packages/db` (backend-infra LLD)
This LLD requires the following columns to exist (declared explicitly so the infra LLD has a verifiable contract):
- `users(id, email UNIQUE, password_hash, created_at)`
- `sessions(id, user_id, token_hash, expires_at, created_at)` — `token_hash` is the HMAC-SHA256 digest, not Argon2.
- `conversations(id, user_id, title, created_at, last_message_at)`
- `messages(id, conversation_id, role, content, status, error_code NULLABLE, created_at, completed_at NULLABLE)` — the `error_code` column is a hard requirement of this LLD; there is no fallback path.
- `inferences(id, message_id, conversation_id, user_id, provider NULLABLE, model NULLABLE, status, ...)` — Phase A only writes the placeholder row keyed on `message_id` with `status='streaming'`; the projection consumer owns enrichment.

### From `packages/contracts`
This LLD imports the following exports (frontend-web LLD is being aligned to consume the same names):
- `WsFrameInboundSchema` — discriminated union of inbound frames (`send`, `cancel`).
- `WsFrameOutboundSchema` — discriminated union of outbound frames (`start`, `token`, `end`, `error`, `cancel-ack`).
- `WsFrameInbound`, `WsFrameOutbound` — inferred TS types for the above.
- `SignupRequestSchema`, `SignupResponseSchema` — REST DTOs for signup.
- `LoginRequestSchema`, `LoginResponseSchema` — REST DTOs for login.
- `LogoutResponseSchema` — REST DTO for logout.
- `ConversationSchema` — single conversation row shape.
- `ConversationListResponseSchema`, `ConversationCreateRequestSchema`, `ConversationCreateResponseSchema`, `ConversationRenameRequestSchema`, `MessageSchema`, `ConversationMessagesResponseSchema` — REST DTOs for the conversation surface.
- `WS_PATH` constant — the WS gateway URL path (`/ws/chat`).

If any of these exports are missing when the builder starts, the builder pauses and files a contracts-LLD task — does not invent local shapes.

### Pinned security parameters
- **Argon2id parameters:** accept the `argon2` npm package version pinned in `apps/api/package.json` (currently the v0.31 family) with its built-in defaults. The hash string itself encodes parameters, so a future param bump is non-breaking for verify. The default-acceptance is documented as a comment in `password.ts`.
- **Session token:** 32 bytes from `crypto.randomBytes`, base64url-encoded (no padding). Stored only as its HMAC-SHA256 digest in `sessions.token_hash`, keyed by the app `SESSION_SECRET` env var, hex-encoded for column storage.
- **Session cookie config (single canonical source — `apps/api/src/common/session-cookie.ts`):** cookie name `argus_sid`; max-age 30 days (in seconds); `httpOnly: true`; `sameSite: 'lax'`; `secure` driven by `COOKIE_SECURE` env var (defaults to true when `NODE_ENV=production`, false otherwise); `path: '/'`; clearing sets the same name/path/sameSite/secure with `maxAge: 0`. Every consumer (auth controller set/clear, session guard read, WS resolver read) imports from this single file.

---

## Tasks

### Task 1 (RED): Failing test for Argon2id `hashPassword` output shape
**Files:** `apps/api/test/auth/password.test.ts`
**What to do:** Write a failing test naming the behavior: hashing produces an Argon2id-formatted string and two hashes of the same plaintext differ.
**Acceptance:** Test exists, runs, fails because `password.ts` is unimplemented.
**Verify:** `pnpm --filter @argus/api test password.test`

### Task 2 (GREEN): Implement `hashPassword`
**Files:** `apps/api/src/auth/password.ts`
**What to do:** Implement the password hasher using the `argon2` package in Argon2id mode with package defaults; takes a plaintext string, returns a promise of the Argon2id-encoded hash string. Document the version-pinning decision inline.
**Acceptance:** Task 1 passes; no other tests broken.
**Verify:** `pnpm --filter @argus/api test`

### Task 3 (RED): Failing test for `verifyPassword` accept/reject behavior
**Files:** `apps/api/test/auth/password.test.ts`
**What to do:** Add failing assertions naming the behavior: verify returns true on a matching plaintext, false on a mismatched plaintext, false on a malformed hash.
**Acceptance:** Test exists, runs, fails because verify is unimplemented.
**Verify:** `pnpm --filter @argus/api test password.test`

### Task 4 (GREEN): Implement `verifyPassword`
**Files:** `apps/api/src/auth/password.ts`
**What to do:** Implement the verifier as a thin wrapper around the argon2 library's verify call that returns false on any thrown error.
**Acceptance:** Task 3 passes.
**Verify:** `pnpm --filter @argus/api test password.test`

### Task 5 (RED): Failing test for opaque session token generation
**Files:** `apps/api/test/auth/session-token.test.ts`
**What to do:** Write a failing test naming the behavior: the generator produces base64url strings, of the length expected from 32 random bytes encoded without padding, and the implementation produces unique outputs across successive calls.
**Acceptance:** Test exists, runs, fails because `session-token.ts` is unimplemented.
**Verify:** `pnpm --filter @argus/api test session-token.test`

### Task 6 (GREEN): Implement opaque session token generator
**Files:** `apps/api/src/auth/session-token.ts`
**What to do:** Implement the generator that returns the base64url encoding (no padding) of 32 bytes from `crypto.randomBytes`.
**Acceptance:** Task 5 passes.
**Verify:** `pnpm --filter @argus/api test session-token.test`

### Task 7 (RED): Failing test for deterministic HMAC-SHA256 session-token hash
**Files:** `apps/api/test/auth/session-token.test.ts`
**What to do:** Add failing assertions naming the behavior: hashing the same token with the same `SESSION_SECRET` always yields the same digest (this is the lookup-key property); hashing the same token with a different secret yields a different digest; hashing different tokens with the same secret yields different digests; the digest is hex-encoded.
**Acceptance:** Test exists, runs, fails because the hasher is unimplemented.
**Verify:** `pnpm --filter @argus/api test session-token.test`

### Task 8 (GREEN): Implement deterministic session-token hasher
**Files:** `apps/api/src/auth/session-token.ts`
**What to do:** Implement the hasher as HMAC-SHA256 with the `SESSION_SECRET` env var as key and the token string as message, returning the hex-encoded digest. Throw a clear error if `SESSION_SECRET` is unset.
**Acceptance:** Task 7 passes.
**Verify:** `pnpm --filter @argus/api test session-token.test`

### Task 9 (RED): Failing test for `AuthService.signup` rejects duplicate email
**Files:** `apps/api/test/auth/auth.service.test.ts`
**What to do:** Write a failing test using the Postgres test fixture: creating a user with the same email twice causes the second signup to reject with `DuplicateEmailError`.
**Acceptance:** Test exists, runs, fails because the service is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 10 (GREEN): Implement `AuthService.signup`
**Files:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/errors.ts`
**What to do:** Implement signup: hash the password, insert into `users`, catch the Prisma unique-violation on email and rethrow as `DuplicateEmailError`, return the created user identifier.
**Acceptance:** Task 9 passes.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 11 (RED): Failing test for `AuthService.login` accept and reject
**Files:** `apps/api/test/auth/auth.service.test.ts`
**What to do:** Add failing assertions naming the behavior: login with correct credentials returns a user identifier plus a fresh opaque session token; login with a wrong password rejects with `InvalidCredentialsError`; login with an unknown email rejects with the same `InvalidCredentialsError` (no user-enumeration).
**Acceptance:** Test exists, runs, fails because login is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 12 (GREEN): Implement `AuthService.login` and session issuance
**Files:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.repository.ts`
**What to do:** Implement login that looks up the user, verifies the password (running a constant-time dummy verify on unknown-email to equalize timing), generates an opaque token, hashes it via the HMAC hasher, persists only the hash plus a 30-day expiry, and returns the plaintext token to the caller.
**Acceptance:** Task 11 passes.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 13 (RED): Failing test that plaintext session tokens are never persisted
**Files:** `apps/api/test/auth/auth.service.test.ts`
**What to do:** Add a failing test naming the behavior: after a successful login, no row anywhere in `sessions` contains the plaintext token value returned to the caller — only its hash.
**Acceptance:** Test exists, runs, fails until the implementation guarantees the property.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 14 (GREEN): Confirm hash-only persistence
**Files:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.repository.ts`
**What to do:** Audit the login path so the only field written for the token is the HMAC digest column. No incidental logging of the plaintext token.
**Acceptance:** Task 13 passes.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 15 (RED): Failing test for `findUserBySessionToken` accepts valid, rejects expired
**Files:** `apps/api/test/auth/auth.service.test.ts`
**What to do:** Add failing assertions naming the behavior: a valid non-expired token resolves to its user identifier; a token whose row has an `expires_at` in the past resolves to null; an unknown token resolves to null.
**Acceptance:** Test exists, runs, fails because lookup is unimplemented or does not check expiry.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 16 (GREEN): Implement `findUserBySessionToken` with expiry check
**Files:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.repository.ts`
**What to do:** Hash the incoming token, query for a session row whose digest matches and whose `expires_at` is in the future, return the joined `user_id` or null.
**Acceptance:** Task 15 passes.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 17 (RED): Failing test for `AuthService.logout` revokes and is idempotent
**Files:** `apps/api/test/auth/auth.service.test.ts`
**What to do:** Add failing assertions naming the behavior: after logout with a valid token, a subsequent lookup returns null; calling logout with an unknown token resolves successfully without throwing.
**Acceptance:** Test exists, runs, fails because logout is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 18 (GREEN): Implement `AuthService.logout`
**Files:** `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.repository.ts`
**What to do:** Hash the incoming token, delete the matching row by digest, treat zero affected rows as success.
**Acceptance:** Task 17 passes.
**Verify:** `pnpm --filter @argus/api test auth.service.test`

### Task 19 (RED): Failing test for shared cookie-parser util
**Files:** `apps/api/test/auth/session.guard.test.ts`
**What to do:** Write a failing test naming the behavior: the shared cookie parser, given a raw `Cookie` header string, extracts the configured session cookie value by name; returns null when the header is missing, malformed, or does not contain the cookie name; correctly decodes URL-encoded values.
**Acceptance:** Test exists, runs, fails because the util is unimplemented.
**Verify:** `pnpm --filter @argus/api test session.guard.test`

### Task 20 (GREEN): Implement shared cookie-parser util
**Files:** `apps/api/src/auth/cookie-parser.util.ts`
**What to do:** Implement the parser as a pure function over a raw header string returning the named cookie value or null. Both the REST guard and the WS resolver will import this.
**Acceptance:** Task 19 passes.
**Verify:** `pnpm --filter @argus/api test session.guard.test`

### Task 21 (RED): Failing test for `SessionGuard` reject on missing or invalid cookie
**Files:** `apps/api/test/auth/session.guard.test.ts`
**What to do:** Add failing tests naming the behavior: the guard rejects (throws an unauthorized exception) when the request carries no session cookie and when the cookie's value does not resolve to a session row. Uses the live cookie-parser util plus a stub `AuthService.findUserBySessionToken`.
**Acceptance:** Test exists, runs, fails because the guard is unimplemented.
**Verify:** `pnpm --filter @argus/api test session.guard.test`

### Task 22 (RED): Failing test for `SessionGuard` attaches user on valid cookie
**Files:** `apps/api/test/auth/session.guard.test.ts`
**What to do:** Add a failing test naming the behavior: on a valid cookie, the guard places a user descriptor with the resolved id onto the request object and permits the call.
**Acceptance:** Test exists, runs, fails because the guard is unimplemented.
**Verify:** `pnpm --filter @argus/api test session.guard.test`

### Task 23 (GREEN): Implement `SessionGuard`
**Files:** `apps/api/src/auth/session.guard.ts`
**What to do:** Implement the guard so it reads the cookie name from the canonical session-cookie module, uses the shared parser on the raw header, calls into `AuthService.findUserBySessionToken`, throws unauthorized on null, and attaches the user descriptor on hit.
**Acceptance:** Tasks 21 and 22 pass.
**Verify:** `pnpm --filter @argus/api test session.guard.test`

### Task 24 (RED): Failing test for `resolveWsUser` parity with REST guard
**Files:** `apps/api/test/auth/ws-session.test.ts`
**What to do:** Write failing tests naming the behavior: given the raw headers map from a Node IncomingMessage (where header values are strings or string arrays), the WS resolver extracts the session cookie via the same shared parser used by the REST guard, returns the user identifier on a valid token, and returns null on missing, malformed, or unknown tokens. A parity assertion: for the same `Cookie` header string, the REST guard and the WS resolver agree on the resolved user identifier across a small table of inputs.
**Acceptance:** Test exists, runs, fails because the resolver is unimplemented.
**Verify:** `pnpm --filter @argus/api test ws-session.test`

### Task 25 (GREEN): Implement `resolveWsUser`
**Files:** `apps/api/src/auth/ws-session.ts`
**What to do:** Implement the resolver to read the `cookie` header (normalizing the string-or-array shape), apply the shared cookie parser, and call into `AuthService.findUserBySessionToken`.
**Acceptance:** Task 24 passes.
**Verify:** `pnpm --filter @argus/api test ws-session.test`

### Task 26 (RED): Failing test for idempotent demo-user seed
**Files:** `apps/api/test/bootstrap/seed.test.ts`
**What to do:** Write a failing test naming the behavior: invoking the seed twice against a clean database results in exactly one demo-user row; the second invocation does not change the user's identifier or password hash.
**Acceptance:** Test exists, runs, fails because the seed is unimplemented.
**Verify:** `pnpm --filter @argus/api test seed.test`

### Task 27 (RED): Failing test for seed environment override
**Files:** `apps/api/test/bootstrap/seed.test.ts`
**What to do:** Add a failing test naming the behavior: when `DEMO_EMAIL` is set in the environment, the seeded user's email matches the override; when it is unset, the documented default is used.
**Acceptance:** Test exists, runs, fails because the seed is unimplemented.
**Verify:** `pnpm --filter @argus/api test seed.test`

### Task 28 (RED): Failing test that re-seeding does not rehash existing user
**Files:** `apps/api/test/bootstrap/seed.test.ts`
**What to do:** Add a failing test naming the behavior: after seeding once and then changing `DEMO_PASSWORD` in the environment and seeding again, the existing user's `password_hash` is left untouched. (The seed is for first-boot convenience, not for credential rotation.)
**Acceptance:** Test exists, runs, fails because the seed is unimplemented.
**Verify:** `pnpm --filter @argus/api test seed.test`

### Task 29 (GREEN): Implement idempotent demo-user seed
**Files:** `apps/api/src/bootstrap/seed.ts`
**What to do:** Implement the seed: read email and password from env with documented defaults, look up by email, insert only on miss (hashing the password at insert time), leave existing rows untouched.
**Acceptance:** Tasks 26, 27, 28 pass.
**Verify:** `pnpm --filter @argus/api test seed.test`

### Task 30 (RED): Failing controller test for `POST /auth/signup` cookie + 201 behavior
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Write a failing test using a NestJS test module with the real auth controller, real auth service, real cookie-parser middleware, and the live Postgres test fixture: a signup with a fresh email returns 201 with a `Set-Cookie` header carrying the configured cookie name; the cookie is `HttpOnly`, `SameSite=Lax`, has the configured max-age, and the response body matches `SignupResponseSchema`.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 31 (RED): Failing controller test for `POST /auth/signup` duplicate-email error
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a signup with an already-registered email returns HTTP 409 and a body shape with a stable error code; no `Set-Cookie` header is emitted on failure.
**Acceptance:** Test exists, runs, fails because the error mapping is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 32 (RED): Failing controller test for `POST /auth/signup` validation error
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Add a failing test naming the behavior: a signup payload that fails `SignupRequestSchema` validation (missing email or password too short) returns HTTP 400 with a body shape describing the validation error.
**Acceptance:** Test exists, runs, fails because validation wiring is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 33 (RED): Failing controller test for `POST /auth/login` accept and reject
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Add failing tests naming the behavior: login with the seeded demo credentials returns 200, a `Set-Cookie` header, and a body matching `LoginResponseSchema`; login with a wrong password returns 401 without a `Set-Cookie` header; login with an unknown email also returns 401 with the same error body shape.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 34 (RED): Failing controller test for `POST /auth/logout` clears the cookie
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Add failing tests naming the behavior: logout with a valid session cookie returns 200, emits a `Set-Cookie` header that clears the cookie (max-age 0, same name/path), and a subsequent request using the original cookie is unauthorized; logout with no cookie or an unknown cookie still returns 200 (idempotent).
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 35 (RED): Failing controller test for 5xx mapping on unexpected service errors
**Files:** `apps/api/test/auth/auth.controller.test.ts`
**What to do:** Add a failing test naming the behavior: when `AuthService.signup` is stubbed to throw a non-domain error, the controller returns HTTP 500 with a generic error body (no stack leak); the error is logged. Same for login.
**Acceptance:** Test exists, runs, fails because the controller mapping is unimplemented.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 36 (GREEN): Implement `AuthModule` providers and DTOs
**Files:** `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/dto/signup.dto.ts`, `apps/api/src/auth/dto/login.dto.ts`
**What to do:** Declare the module exporting `AuthService`, `SessionRepository`, `SessionGuard`, the cookie-parser util, and the WS resolver. DTOs re-export the request schemas from `@argus/contracts` so the controller can validate via zod.
**Acceptance:** Module instantiates inside the controller tests without missing-provider errors.
**Verify:** `pnpm --filter @argus/api typecheck`

### Task 37 (GREEN): Implement `auth.controller` signup handler
**Files:** `apps/api/src/auth/auth.controller.ts`
**What to do:** Implement the signup handler: parse via `SignupRequestSchema`, call `AuthService.signup`, set the session cookie via the canonical helper, return 201 with a body matching `SignupResponseSchema`, map `DuplicateEmailError` to 409, map validation failures to 400.
**Acceptance:** Tasks 30, 31, 32 pass.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 38 (GREEN): Implement `auth.controller` login handler
**Files:** `apps/api/src/auth/auth.controller.ts`
**What to do:** Implement the login handler: parse via `LoginRequestSchema`, call `AuthService.login`, set the cookie via the canonical helper, return 200 with `LoginResponseSchema`, map `InvalidCredentialsError` to 401.
**Acceptance:** Task 33 passes.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 39 (GREEN): Implement `auth.controller` logout handler
**Files:** `apps/api/src/auth/auth.controller.ts`
**What to do:** Implement the logout handler: read the cookie via the canonical helper, call `AuthService.logout`, clear the cookie via the canonical helper, return 200 with `LogoutResponseSchema` regardless of whether a session was actually deleted.
**Acceptance:** Task 34 passes.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 40 (GREEN): Implement controller-level 5xx mapping
**Files:** `apps/api/src/auth/auth.controller.ts`
**What to do:** Catch non-domain errors at the controller boundary, log them via Nest's logger, and rethrow as a generic internal-server error response with no stack content.
**Acceptance:** Task 35 passes.
**Verify:** `pnpm --filter @argus/api test auth.controller.test`

### Task 41 (RED): Failing test for `ConversationsRepository.listForUser`
**Files:** `apps/api/test/conversations/conversations.repository.test.ts`
**What to do:** Write a failing test naming the behavior: with two seeded users each owning conversations, the list method called with user A's id returns only user A's rows, ordered by `last_message_at` descending.
**Acceptance:** Test exists, runs, fails because the repository is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 42 (GREEN): Implement `ConversationsRepository.listForUser`
**Files:** `apps/api/src/conversations/conversations.repository.ts`
**What to do:** Implement the list method as a Prisma query filtered by `user_id` and ordered by `last_message_at` descending.
**Acceptance:** Task 41 passes.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 43 (RED): Failing test for `getByIdForUser` cross-user rejection
**Files:** `apps/api/test/conversations/conversations.repository.test.ts`
**What to do:** Add a failing test naming the behavior: the get-by-id method returns the row when the requesting user owns it and returns null when a different user requests it even though the conversation id exists.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 44 (GREEN): Implement `getByIdForUser`
**Files:** `apps/api/src/conversations/conversations.repository.ts`
**What to do:** Implement the method as a Prisma find-first filtered by both the id and the owning user identifier.
**Acceptance:** Task 43 passes.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 45 (RED): Failing tests for `create`, `rename`, `delete` user ownership
**Files:** `apps/api/test/conversations/conversations.repository.test.ts`
**What to do:** Add failing tests naming the behavior: create stamps the conversation with the calling user's id; rename updates only when ownership matches and reports zero-update otherwise; delete removes only when ownership matches and reports zero-delete otherwise.
**Acceptance:** Tests exist, run, fail because the methods are unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 46 (GREEN): Implement `create`, `rename`, `delete` with user filter
**Files:** `apps/api/src/conversations/conversations.repository.ts`
**What to do:** Implement each method so every write includes a where clause filtered by user id and surfaces zero-affected as a non-throw signal the caller can map to a 404.
**Acceptance:** Task 45 passes.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 47 (RED): Failing test for `MessagesRepository.listForConversation` user scoping
**Files:** `apps/api/test/conversations/conversations.repository.test.ts`
**What to do:** Write a failing test naming the behavior: the list-messages method returns the message rows only when the requesting user owns the conversation, and returns null otherwise.
**Acceptance:** Test exists, runs, fails because the repository is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 48 (GREEN): Implement `MessagesRepository`
**Files:** `apps/api/src/conversations/messages.repository.ts`
**What to do:** Implement the read methods so each Prisma query joins through the conversation row and filters by user id.
**Acceptance:** Task 47 passes.
**Verify:** `pnpm --filter @argus/api test conversations.repository.test`

### Task 49 (RED): Failing registry-driven cross-user authorization test
**Files:** `apps/api/test/common/repository-authorization.test.ts`
**What to do:** Write a failing test naming the behavior: an explicit registry lists every public read method of `ConversationsRepository` and `MessagesRepository` plus the user-id argument shape. The test seeds two users with rows in each table and asserts every listed method, called with user A's id, never returns user B's rows. A separate assertion fails loudly if the count of exported public methods on either repository exceeds the registry's entry count (so adding a method without registering it breaks the build). Avoids reflection over private helpers by relying on an explicitly maintained registry.
**Acceptance:** Test exists, runs, fails for any unimplemented method.
**Verify:** `pnpm --filter @argus/api test repository-authorization.test`

### Task 50 (GREEN): Make the registry-driven test pass
**Files:** `apps/api/src/conversations/conversations.repository.ts`, `apps/api/src/conversations/messages.repository.ts`
**What to do:** Audit every read method already implemented above to confirm it enforces ownership; add the registry entries for each. The test is the gate.
**Acceptance:** Task 49 passes.
**Verify:** `pnpm --filter @argus/api test repository-authorization.test`

### Task 51 (RED): Failing controller test for `GET /conversations` list
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Write a failing test naming the behavior: an authenticated `GET /conversations` returns only the calling user's conversations; an unauthenticated call returns 401; the response body matches `ConversationListResponseSchema`.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 52 (GREEN): Implement list endpoint
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler, guarded by `SessionGuard`, that calls the repository and serializes through the contracts schema.
**Acceptance:** Task 51 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 53 (RED): Failing controller test for `GET /conversations/:id` cross-user rejection
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test naming the behavior: calling the get endpoint with user B's cookie on user A's conversation id returns 404 (not 403 — do not leak existence).
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 54 (GREEN): Implement get endpoint with cross-user 404
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler that calls `getByIdForUser` and maps null to 404.
**Acceptance:** Task 53 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 55 (RED): Failing controller test for `POST /conversations` create
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test naming the behavior: create with a valid payload returns 201 and the created conversation stamped with the calling user's id; a malformed payload returns 400.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 56 (GREEN): Implement create endpoint
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler with `ConversationCreateRequestSchema` validation and `ConversationCreateResponseSchema` serialization.
**Acceptance:** Task 55 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 57 (RED): Failing controller test for `PATCH /conversations/:id` rename + cross-user 404
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test naming the behavior: rename by the owner returns 200 and the updated row; rename by a different user returns 404 and does not mutate the row.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 58 (GREEN): Implement rename endpoint
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler with `ConversationRenameRequestSchema` validation and zero-affected mapped to 404.
**Acceptance:** Task 57 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 59 (RED): Failing controller test for `DELETE /conversations/:id`
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test naming the behavior: delete by the owner returns 204; delete by a different user returns 404 and leaves the row intact.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 60 (GREEN): Implement delete endpoint
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler that calls the user-scoped delete and maps zero-affected to 404.
**Acceptance:** Task 59 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 61 (RED): Failing controller test for `GET /conversations/:id/messages`
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test naming the behavior: the messages endpoint returns the message list when the caller owns the conversation; returns 404 when a different user requests it; the response matches `ConversationMessagesResponseSchema`.
**Acceptance:** Test exists, runs, fails because the controller is unimplemented.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 62 (GREEN): Implement messages endpoint
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Implement the handler that calls `MessagesRepository.listForConversation` and maps null to 404.
**Acceptance:** Task 61 passes.
**Verify:** `pnpm --filter @argus/api test conversations.controller.test`

### Task 63 (GREEN): Wire `ConversationsModule`
**Files:** `apps/api/src/conversations/conversations.module.ts`
**What to do:** Declare the module exporting `ConversationsRepository`, `MessagesRepository`, and the controller; import `AuthModule` for `SessionGuard`.
**Acceptance:** Conversation controller tests all instantiate without missing-provider errors.
**Verify:** `pnpm --filter @argus/api typecheck`

### Task 64 (RED): Failing test for `mintMessageId` uniqueness
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: the id-minting helper produces unique strings matching a UUID v4 pattern across successive calls.
**Acceptance:** Test exists, runs, fails because the helper is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 65 (GREEN): Implement `mintMessageId`
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Implement the minter as a thin wrapper over the standard library's UUID v4 generator.
**Acceptance:** Task 64 passes.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 66 (RED): Failing tests for `SeqCounter` and `SeqCounterRegistry`
**Files:** `apps/api/test/chat/seq-counter.test.ts`
**What to do:** Write failing tests naming the behavior: a counter's `next` call returns strictly increasing integers starting from zero; two independent counters do not share state; the registry keyed by message id returns the same counter on repeated access; `release(messageId)` removes the counter so a subsequent access yields a fresh one starting at zero.
**Acceptance:** Tests exist, run, fail because the helpers are unimplemented.
**Verify:** `pnpm --filter @argus/api test seq-counter.test`

### Task 67 (GREEN): Implement `SeqCounter` and `SeqCounterRegistry`
**Files:** `apps/api/src/chat/seq-counter.ts`
**What to do:** Implement the counter and a registry that lazily creates a counter on first access, returns the same instance on subsequent access by the same message id, and removes the entry on release.
**Acceptance:** Task 66 passes.
**Verify:** `pnpm --filter @argus/api test seq-counter.test`

### Task 68 (RED): Failing tests for `buildStartFrame`
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Write failing tests naming the behavior: the start-frame builder, given message id, conversation id, provider, model, returns an object that validates against `WsFrameOutboundSchema` as the start variant with seq zero.
**Acceptance:** Test exists, runs, fails because the builder is unimplemented.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 69 (GREEN): Implement `buildStartFrame`
**Files:** `apps/api/src/chat/frame-builder.ts`
**What to do:** Implement the builder to produce the literal start envelope shape required by the contracts schema.
**Acceptance:** Task 68 passes.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 70 (RED): Failing tests for `buildTokenFrame` monotonic seq
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Add failing tests naming the behavior: token frames validate against `WsFrameOutboundSchema` as the token variant; sequential builder calls fed by a `SeqCounter` produce strictly increasing seq values starting at one.
**Acceptance:** Test exists, runs, fails because the builder is unimplemented.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 71 (GREEN): Implement `buildTokenFrame`
**Files:** `apps/api/src/chat/frame-builder.ts`
**What to do:** Implement the token builder producing the typed envelope.
**Acceptance:** Task 70 passes.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 72 (RED): Failing tests for end, error, cancel-ack builders
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Add failing tests naming the behavior: the end builder carries the terminal status (complete, canceled, failed) and a terminal seq; the error builder carries an error code and optional message; the cancel-ack builder carries the message id. All three validate against `WsFrameOutboundSchema`.
**Acceptance:** Test exists, runs, fails because the builders are unimplemented.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 73 (GREEN): Implement remaining frame builders
**Files:** `apps/api/src/chat/frame-builder.ts`
**What to do:** Implement the three builders matching the contracts envelope shapes.
**Acceptance:** Task 72 passes.
**Verify:** `pnpm --filter @argus/api test frame-builder.test`

### Task 74 (RED): Failing test for `ChatService.startTurn` ownership rejection
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: `startTurn` called with a conversation id that does not belong to the calling user rejects with a domain authorization error and does not insert any rows.
**Acceptance:** Test exists, runs, fails because the ownership check is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 75 (RED): Failing test for `ChatService.startTurn` transactional outbox
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: a successful `startTurn` produces, in a single Prisma transaction, a user-role message row, an assistant-role message row stamped `status='streaming'`, an updated `last_message_at` on the conversation, and a placeholder `inferences` row keyed on the assistant message id with `status='streaming'` and null token counts. The method returns the assistant message id. It does not invoke any SDK surface.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 76 (RED): Failing test for `ChatService.startTurn` transactional atomicity
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test naming the behavior: when the inferences-placeholder insert is forced to fail (by violating a uniqueness constraint via a duplicate seeded row), `startTurn` rejects and no message rows from this turn are persisted (the transaction rolls back fully).
**Acceptance:** Test exists, runs, fails because the transactional wrapping is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 77 (GREEN): Implement `ChatService.startTurn`
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Implement the method: verify the conversation belongs to the calling user (rejection on mismatch), open a Prisma transaction, insert the user message, mint the assistant message id, insert the assistant message with streaming status, update the conversation's last-message timestamp, insert the inferences placeholder keyed on the assistant message id, commit, return the assistant id. Does not call the SDK.
**Acceptance:** Tasks 74, 75, 76 pass.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 78 (RED): Failing test for `ChatService.completeTurn`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: completing a turn sets the assistant message's status to complete, writes the full accumulated content, and stamps `completed_at`. The corresponding inferences placeholder row is left untouched (the projection consumer owns enrichment per HLD D1) — assert by snapshotting the row before and comparing equal after.
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 79 (GREEN): Implement `ChatService.completeTurn`
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Implement the method as a targeted update on the assistant message row only.
**Acceptance:** Task 78 passes.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 80 (RED): Failing test for `ChatService.cancelTurn`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: cancel writes any partial content, sets status to canceled, stamps `completed_at`; the inferences placeholder is unchanged (row-snapshot equal).
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 81 (GREEN): Implement `ChatService.cancelTurn`
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Implement the method as a single message-row update.
**Acceptance:** Task 80 passes.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 82 (RED): Failing test for `ChatService.failTurn`
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Write a failing test naming the behavior: fail writes the partial content, sets status to failed, writes the `error_code` column, stamps `completed_at`; the inferences placeholder is unchanged (row-snapshot equal).
**Acceptance:** Test exists, runs, fails because the method is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 83 (GREEN): Implement `ChatService.failTurn`
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Implement the method as a single message-row update writing partial content, status, error code, and the completion timestamp.
**Acceptance:** Task 82 passes.
**Verify:** `pnpm --filter @argus/api test chat.service.test`

### Task 84 (RED): Failing test for `StreamOrchestrator` happy path
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Write a failing test naming the behavior: running the orchestrator with a mock SDK stream that yields a small number of tokens followed by a done event causes the emit callback to receive a start frame, the corresponding token frames in order, then an end frame with status complete; the orchestrator calls `ChatService.completeTurn` with the accumulated content; the seq registry's `release` is called for that message id on completion.
**Acceptance:** Test exists, runs, fails because the orchestrator is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 85 (GREEN): Implement `StreamOrchestrator` happy path
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Implement the orchestrator's run method: acquire a seq counter, emit start, iterate the SDK stream emitting token frames, on done call `completeTurn` with accumulated content, emit end with complete status, release the counter.
**Acceptance:** Task 84 passes.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 86 (RED): Failing test for `StreamOrchestrator` cancel path
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Write a failing test naming the behavior: invoking cancel after some tokens have streamed aborts the SDK iterator via its abort signal, calls `cancelTurn` with the accumulated partial content, emits a cancel-ack then an end frame with canceled status, drops any token that races the abort, and releases the seq counter.
**Acceptance:** Test exists, runs, fails because cancel is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 87 (GREEN): Implement cancel path
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Wire an abort controller through to the SDK stream; expose a cancel method that aborts, calls `cancelTurn`, emits cancel-ack and end with a terminal-state flag guarding late tokens; release the counter.
**Acceptance:** Task 86 passes.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 88 (RED): Failing test for cancel-for-unknown-message
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Write a failing test naming the behavior: a cancel request for a message id that has no active orchestrator is a no-op and does not throw, and does not call `cancelTurn`.
**Acceptance:** Test exists, runs, fails because the registry behavior is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 89 (GREEN): Implement no-op cancel for unknown message id
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Implement the active-orchestrator registry so missing-key cancel is a silent no-op.
**Acceptance:** Task 88 passes.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 90 (RED): Failing test for `StreamOrchestrator` disconnect path
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Write a failing test naming the behavior: invoking the disconnect handler after some tokens have streamed aborts the SDK iterator, calls `failTurn` with the partial content and the error code `client_disconnected`, does not call any emit callbacks (the socket is gone), and releases the seq counter.
**Acceptance:** Test exists, runs, fails because disconnect is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 91 (GREEN): Implement disconnect path
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Implement the disconnect handler: abort, call `failTurn` with the documented error code, suppress emit calls, release the counter.
**Acceptance:** Task 90 passes.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 92 (RED): Failing test for pre-first-token SDK failure
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Write a failing test naming the behavior: when the SDK stream throws before yielding any token, the orchestrator calls `failTurn` with empty partial content and the SDK-propagated error code, emits an error frame, emits an end frame with failed status, and releases the seq counter.
**Acceptance:** Test exists, runs, fails because the failure path is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 93 (RED): Failing test for post-first-token SDK failure
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test naming the behavior: when the SDK stream throws after yielding one or more tokens, the orchestrator calls `failTurn` with the accumulated partial content and the SDK-propagated error code, emits an error frame, emits an end frame with failed status, and releases the seq counter. (Per HLD, no provider stitching.)
**Acceptance:** Test exists, runs, fails because the partial-failure path is unimplemented.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 94 (GREEN): Implement SDK-failure paths
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Wrap the iteration in try/catch handling both pre- and post-first-token failures with a single code path that calls `failTurn`, emits the error and terminal-end frames, releases the counter.
**Acceptance:** Tasks 92 and 93 pass.
**Verify:** `pnpm --filter @argus/api test stream-orchestrator.test`

### Task 95 (RED): Failing gateway test for handshake authentication
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Write a failing test naming the behavior: a WS connection attempt with no cookie is rejected at handshake; a connection with a valid session cookie is accepted and the user descriptor is attached to the connection's data; a connection with a malformed cookie is rejected.
**Acceptance:** Test exists, runs, fails because the gateway handshake is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 96 (GREEN): Implement gateway scaffold and handshake auth
**Files:** `apps/api/src/chat/chat.gateway.ts`, `apps/api/src/chat/chat.module.ts`
**What to do:** Declare `ChatModule` providing `ChatService`, `StreamOrchestrator`, `SeqCounterRegistry`, `ConversationsRepository`, `MessagesRepository`, `PrismaService`, and the SDK client; declare `ChatGateway` mounted on `WS_PATH` from contracts; in the connection lifecycle, call `resolveWsUser` on the handshake headers and disconnect on null, otherwise attach the user descriptor to the connection.
**Acceptance:** Task 95 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 97 (RED): Failing gateway test for inbound frame validation
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: an inbound frame that does not validate against `WsFrameInboundSchema` is rejected (emits an error frame to the client and is otherwise a no-op); the gateway does not crash on malformed input.
**Acceptance:** Test exists, runs, fails because validation is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 98 (GREEN): Implement inbound frame validation
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** At the top of every inbound handler, parse the payload via the contracts schema; on parse failure emit an error frame with a stable code and return.
**Acceptance:** Task 97 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 99 (RED): Failing gateway test for send handler
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: a valid send frame causes the gateway to call `ChatService.startTurn` with the authenticated user id and the frame's conversation id, register a new orchestrator keyed on the returned assistant message id, and kick off the orchestrator (which proceeds to call the SDK). The gateway itself never updates `messages.status`.
**Acceptance:** Test exists, runs, fails because the send handler is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 100 (GREEN): Implement send handler
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Implement the send handler delegating to `ChatService.startTurn` then constructing and starting the `StreamOrchestrator`, registering it in the per-client map keyed on assistant message id.
**Acceptance:** Task 99 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 101 (RED): Failing gateway test for cancel handler
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: a valid cancel frame referencing an active message id calls cancel on that orchestrator; a cancel frame referencing an unknown message id is a no-op and does not error.
**Acceptance:** Test exists, runs, fails because the cancel handler is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 102 (GREEN): Implement cancel handler
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Look up the orchestrator in the per-client registry and call cancel; missing entry is a silent no-op.
**Acceptance:** Task 101 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 103 (RED): Failing gateway test for disconnect cleanup
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test naming the behavior: when a client disconnects with active orchestrators, the gateway invokes the disconnect handler on each, and the per-client registry is cleared. Releases all associated seq counters.
**Acceptance:** Test exists, runs, fails because the disconnect cleanup is unimplemented.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 104 (GREEN): Implement disconnect cleanup
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** On disconnect, iterate the per-client orchestrator registry calling `onDisconnect` on each, then clear the registry.
**Acceptance:** Task 103 passes.
**Verify:** `pnpm --filter @argus/api test chat.gateway.test`

### Task 105: [non-TDD — Nest bootstrap glue] Wire seed and cookie-parser into `main.ts`
**Files:** `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
**What to do:** Create the Nest app factory; register cookie-parser middleware; before listening, resolve `PrismaService`, run the seed, log the demo email. Import `AuthModule`, `ConversationsModule`, `ChatModule` into the root module.
**Acceptance:** Manual smoke: `pnpm --filter @argus/api dev` against a clean database logs the demo email and does not error on a second boot against the same database; a curl against `/auth/login` with the demo credentials sets the cookie.
**Verify:** Two-boot manual run.

### Task 106: [non-TDD — boot-order assertion] Preflight DB ping in `main.ts`
**Files:** `apps/api/src/main.ts`
**What to do:** Before running the seed, perform a `SELECT 1` via Prisma and fail-fast with a clear log if it throws, so compose boot-order regressions surface immediately.
**Acceptance:** Manual smoke: starting the API with Postgres stopped exits non-zero within five seconds with a "database not reachable" log line; starting it with Postgres up succeeds.
**Verify:** `docker compose stop postgres && pnpm --filter @argus/api dev` then restart postgres and retry.

### Task 107: [non-TDD — gateway smoke] Manual WS walkthrough
**Files:** none (manual)
**What to do:** With the API running against compose, use `wscat` to (a) connect without a cookie and observe rejection, (b) connect with the demo user's cookie, send a valid send frame, observe a start frame within 500ms followed by token frames and an end frame, (c) repeat and send a cancel frame mid-stream, observe cancel-ack then end. Spot-check `psql` to confirm message and placeholder inferences rows are present.
**Acceptance:** All three scenarios behave as described; database rows match.
**Verify:** Manual walk-through with `wscat -c ws://localhost:4000/ws/chat -H "Cookie: argus_sid=..."`.

## Quality Gates
- type-check: `pnpm --filter @argus/api typecheck`
- lint: `pnpm --filter @argus/api lint`
- test: `pnpm --filter @argus/api test`

## Open Questions

- **`SeqCounterRegistry` backstop release on abnormal exit.** Counters are released by the orchestrator on every documented terminal path (complete, cancel, disconnect, SDK-fail) and tests cover each. The gateway's `handleDisconnect` also iterates orchestrators which themselves release. *Absent override:* no additional periodic GC; if a future bug leaves an orphan counter, memory growth is bounded by active connections.
- **Cross-tab streaming for the same conversation.** HLD assumes one active tab per user. *Absent override:* a second tab opening a WS for the same user is accepted; if both send on the same conversation, each receives its own orchestrator with a distinct minted assistant message id — no cross-tab lock in Phase A. Documented for HLD follow-up if it becomes relevant.
- **5xx response body shape.** Codex flagged that error responses should be stable for the frontend reducer. *Absent override:* this LLD uses Nest's default exception filter producing `{ statusCode, message }`; if the contracts package adds an `ErrorResponseSchema`, the controller mapping in Task 40 swaps to it.
- **Test fixture transaction isolation across concurrent tests.** `@quramy/jest-prisma` wraps each test in a transaction. If Jest is run with `--maxWorkers > 1`, parallel workers share the database but not the transaction, which is fine as long as no test relies on a specific row count. *Absent override:* Jest project config sets `maxWorkers: 1` for the api project to keep tests deterministic; documented in the api package README.

## Reviewer Concerns (acknowledged, deferred or punted)

- **Timing-attack tests for the login dummy-verify path.** Out of scope: timing assertions are flaky in CI; the constant-time dummy verify is implemented and documented in Task 12 but not asserted.
- **Exhaustive operational failure-mode catalog** (Postgres flap mid-transaction, OS-level signal handling for the seed step, etc.). Belongs in the infra LLD and the README runbook; this LLD addresses the API-internal surface only.
- **Per-conversation in-flight lock to prevent concurrent send frames on the same conversation.** PRD says the send control is disabled in the UI while a turn streams; this LLD does not add a server-side enforcement because two concurrent `startTurn` calls on the same conversation would each succeed with distinct assistant message ids, which is a degraded but not broken outcome. Flagged for HLD reconsideration if Phase B Replay produces ambiguity.
