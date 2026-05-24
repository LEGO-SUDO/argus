---
phase: lld
status: APPROVED
slug: chat-context-and-ux-polish
created: 2026-05-24T17:36:05Z
updated: 2026-05-24T19:50:00Z
---

# LLD: backend-api — Chat UX, Multi-Turn Context, and Provider Surface

## Preamble — protocol semantics (binding before any task)

Three load-bearing semantic rules. The whole task plan depends on these — read first.

1. **`commit` carries the final provider + model.** The committed adapter is a runtime singleton with a fixed `name` (`openai|anthropic|gemini|mock`). The router picks an adapter, the adapter knows what it is. The first non-empty token from that adapter is the commit point. Provider and model are both known at commit time — model is the request's chosen model, supplied by the gateway when threading the SDK request, defaulting to the adapter's primary entry from the catalog when none is pinned.
2. **Metadata frame emits EXACTLY ONCE per turn, sourced from `commit`.** Never from `done`. No correction frame, no re-emission. The `done` chunk's `providerMeta` exists for the inferences-row enrichment downstream and carries the same provider + model the metadata frame already shipped.
3. **Pre-token failure path:** no `commit` chunk → no metadata frame → `start` → `error` → `end (status=failed)`. The chip transitions ellipsis → failure without ever displaying a provider name (per HLD §Regression Risk Surface).

## Preamble — cross-LLD coordination

Sibling LLD `lld-frontend-web.md` is generated in parallel. Coordination per HLD §Sequencing:

- The **backbone PR** is the minimum atomic unit that compiles, runs, and ships the new metadata frame + context-fields-on-end + multi-turn context + pin behavior end-to-end. It MUST contain every backend task that the live system needs to keep working after the discriminated union expands.

  - From this LLD, the backbone PR is: **Tasks 1 through 89**. That is the whole backend surface for this feature. The reasoning is that the contracts discriminated union, the SDK commit chunk, the orchestrator metadata frame, the Prisma migration adding pin columns, the gateway pin-threading, the meter service, and the controller endpoints all touch the same exhaustive switches and shared schemas. Cutting between them leaves the system in a state where the gateway expects columns that don't exist, or the controller validates against a helper that isn't exported, or persisted pins have no read-path. The whole backend domain ships together.
  - From the sibling frontend-web LLD: backbone PR also includes the reducer changes, frame-type cases, the new `metadata` action, the expanded `end` action, and the `useConversationHistory` hydration for the new `tokensUsed` / `tokensBudget` / `pinFallback` / `previouslyPinned` response fields.

- **Follow-up PRs** (each ships standalone, none blocks the others):
  - **Task 90** (observability smoke test) — local-only verification; no production code change.
  - From the sibling frontend-web LLD: `ProviderPicker` UI dropdown, `ContextMeter` UI component, Markdown rendering surface, composer focus hook. Each is independent.

- The Prisma migration (Task 35) ships **inside the backbone PR** — gateway code (Tasks 60+) depends on the new columns, and the controller (Tasks 70+) reads/writes them.

This LLD owns the **backend-api** surface only: `packages/contracts`, `packages/sdk`, `packages/db`, `apps/api`. Web reducer changes, picker UI, Markdown rendering, `ContextMeter` component, focus hook — all live in the frontend-web LLD.

## Builder
**agent:** backend-api-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** see `~/.claude/skills/oh/prompts/builder-addendum.md`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the actual tests via the wrapper

## Naming conventions (binding for every task below)

- New WS frame discriminant: `metadata` (lower-kebab, matches existing `cancel-ack`).
- New SDK request field: `pin` (absent = Auto).
- New SDK error code on override-branch failure: `pinned_provider_unavailable`.
- New SDK chunk variant: `commit`. The chunk carries the same provider/model payload the `done` chunk would carry.
- New Prisma columns on `Conversation`: `pinned_provider` and `pinned_model` (both nullable text). TS-side names follow the existing repo convention (camelCase on the Prisma model, `@map` to snake_case).
- New OTel span attribute keys (in `packages/contracts/src/otel-attrs.ts`): `llm.context_budget_effective`, `llm.context_window_cap`, `llm.pinned_failure`, `llm.guess_commit_divergent`.
- New REST endpoint for picker catalog: `GET /providers`.
- New context-meter service class: `ContextMeterService`, exposed via the chat module.
- Nest provider token for the SDK catalog accessor: `SDK_CATALOG`. Backed by the SDK's internal `listConfiguredProviders` helper. Tests inject a stub via `Test.createTestingModule({ providers: [{ provide: SDK_CATALOG, useValue: stub }] })`.

## Decisions resolving Codex's vagueness flags

- **Zod open-shape policy for `providerMeta`:** use `.passthrough()`. Unknown keys land in the parsed object without contract churn.
- **First-configured-adapter-name (for `guessProvider`):** the router's priority head — the first adapter from `PROVIDER_ORDER` (env, default `openai,anthropic,gemini`) whose `isConfigured()` returns true. If none are configured and `MOCK_PROVIDER=true`, it is `mock`.
- **Token-heuristic ownership:** the existing `apps/api/src/conversations/context-window.ts` helper extracts to `apps/api/src/common/token-heuristic.ts`. Both `ContextMeterService` (in `apps/api/src/chat/`) and the `conversations` controller read from `common/`. This prevents a `chat → conversations` cross-module import (which would invert layering) and the reverse.
- **`MOCK_PROVIDER` source of truth:** `.env.example` ships `MOCK_PROVIDER=true` (default-on for local dev); production deployments set it to `false` explicitly. The router's `envMockOnly()` already reflects this. The picker shows the mock provider only when the env is true.
- **Catalog injection:** `ContextMeterService`, `ProvidersController`, and `ConversationsController` consume the catalog via the Nest `SDK_CATALOG` provider token (a module-level provider that returns the SDK's `listConfiguredProviders` accessor). Mocked in tests by overriding the token.
- **Migration rollback strategy:** Argus uses forward-only Prisma migrations (`prisma migrate deploy`). The migration is schema-additive (two nullable columns). Rollback = ship a new forward migration that drops the columns. State this in the migration's header comment.

## Tasks

---

### Task 1 (RED): Failing schema test — `start` frame rejects `provider`/`model`
**Files:** `packages/contracts/src/__tests__/ws.test.ts`
**What to do:** Write a failing test asserting the `start` frame schema no longer accepts `provider` or `model` keys (parse rejects when present), and accepts the minimal identity payload (type, messageId, conversationId, seq).
**Acceptance:** Test fails because the current schema still accepts those keys.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts`.

### Task 2 (GREEN): Drop provider/model from the `start` frame
**Files:** `packages/contracts/src/ws.ts`
**What to do:** Remove the two keys from the `start` frame schema; keep the `seq: 0` literal. Update the module-header comment to reflect that `start` is now identity-only.
**Acceptance:** Task 1's test passes; existing contracts tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 3 (RED): Failing schema test — outbound `metadata` frame parses, rejects missing `providerMeta`, rejects unknown discriminants
**Files:** `packages/contracts/src/__tests__/ws.test.ts`
**What to do:** Add a failing test covering: valid metadata frame parses through the outbound discriminated union; metadata frame missing the nested `providerMeta` is rejected; unknown frame `type` still rejected.
**Acceptance:** Tests fail because no `metadata` variant exists in the union.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts`.

### Task 4 (GREEN): Add the `metadata` frame to the outbound union
**Files:** `packages/contracts/src/ws.ts`, `packages/contracts/src/index.ts`
**What to do:** Add an outbound metadata frame schema with `messageId`, integer `seq ≥ 1`, and a nested `providerMeta` object containing provider + model strings. The nested object uses Zod `.passthrough()` so unknown keys land without contract churn. Re-export the schema + inferred type. Add to the outbound discriminated union. Update the header comment with the metadata discriminant and the `seq` invariant: `start@0 → metadata@1 → token@2..N → terminal`.
**Acceptance:** Task 3's tests pass; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 5 (RED): Failing contract test — metadata frame's `seq` MUST be exactly 1
**Files:** `packages/contracts/src/__tests__/ws.test.ts`
**What to do:** Add a failing test asserting that the metadata frame schema rejects `seq` values other than `1`. Covers the contract-level invariant from the header comment (the first metadata frame in a turn always lands at seq 1, immediately after start@0).
**Acceptance:** Test fails because Task 4's schema currently accepts any integer ≥ 1.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts`.

### Task 6 (GREEN): Pin metadata `seq` to literal 1
**Files:** `packages/contracts/src/ws.ts`
**What to do:** Tighten the metadata frame schema's `seq` field to the literal `1`. Update the inline comment naming this LLD as the contract source.
**Acceptance:** Task 5's test passes; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 7 (RED): Failing schema test — `end` frame carries optional `tokensUsed` + `tokensBudget`
**Files:** `packages/contracts/src/__tests__/ws.test.ts`
**What to do:** Add a failing test covering: end frame with both fields parses; end frame without them parses (backward compat); negative numbers rejected.
**Acceptance:** Tests fail because the fields are not on the schema.
**Verify:** `pnpm --filter @argus/contracts test -- ws.test.ts`.

### Task 8 (GREEN): Extend `end` frame with optional context fields
**Files:** `packages/contracts/src/ws.ts`
**What to do:** Add two optional non-negative integer fields (tokensUsed, tokensBudget) to the end frame schema. Document inline that they are populated only when `status: 'complete'` per HLD D5; orchestrator-side enforcement lives in `apps/api`.
**Acceptance:** Task 7's tests pass; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 9 (RED): Failing test — `MessageListResponseSchema` exposes context fields
**Files:** `packages/contracts/src/__tests__/conversations.test.ts`
**What to do:** Add a failing test covering: response without context fields parses; response with both fields parses; negative values rejected.
**Acceptance:** Tests fail because the schema does not expose the fields.
**Verify:** `pnpm --filter @argus/contracts test -- conversations.test.ts`.

### Task 10 (GREEN): Add `tokensUsed` + `tokensBudget` to `MessageListResponseSchema`
**Files:** `packages/contracts/src/conversations.ts`
**What to do:** Add two optional non-negative integer fields at the response root. Cross-reference HLD D5 + this LLD in the inline comment.
**Acceptance:** Task 9's tests pass; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 11 (RED): Failing test — `UpdateConversationRequestSchema` accepts pin fields with coupling rule
**Files:** `packages/contracts/src/__tests__/conversations.test.ts`
**What to do:** Add a failing test covering: existing `{ title }` body still parses; both pin fields together parse; both pin fields null together parses (clear-pin); one pin field alone is rejected (coupling); empty body parses (no-op PATCH); empty string for either pin field is rejected.
**Acceptance:** Tests fail because the schema only has `title`.
**Verify:** `pnpm --filter @argus/contracts test -- conversations.test.ts`.

### Task 12 (GREEN): Expand `UpdateConversationRequestSchema` with pin fields
**Files:** `packages/contracts/src/conversations.ts`
**What to do:** Make title optional. Add two optional, nullable string pin fields. Use a `.refine()` enforcing the coupling rule: if one is present, the other must be too, and either both are non-empty strings or both are null. Document the coupling rule inline.
**Acceptance:** Task 11's tests pass; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 13 (RED): Failing test — `ConversationDtoSchema` exposes pin fields
**Files:** `packages/contracts/src/__tests__/conversations.test.ts`
**What to do:** Add a failing test asserting the conversation DTO schema accepts optional nullable pin fields (both must round-trip through parse).
**Acceptance:** Test fails because the DTO does not have the fields.
**Verify:** `pnpm --filter @argus/contracts test -- conversations.test.ts`.

### Task 14 (GREEN): Add pin fields to `ConversationDtoSchema`
**Files:** `packages/contracts/src/conversations.ts`
**What to do:** Add two optional nullable string pin fields to the DTO. Document inline that the read response carries them so the picker can render the current pin state.
**Acceptance:** Task 13's test passes; existing tests pass.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

---

### Task 15 (RED): Failing test — `getCatalogEntry(provider, model)` returns price + context window for known, null for unknown
**Files:** `packages/sdk/src/__tests__/cost.test.ts`
**What to do:** Add a failing test covering the new accessor's contract: for known (provider, model) pairs returns combined cost + integer context window; for unknown returns `null`. Cover at least one known entry per provider family and one unknown.
**Acceptance:** Test fails because the accessor does not exist.
**Verify:** `pnpm --filter @argus/sdk test -- cost.test.ts`.

### Task 16 (GREEN): Extend pricebook with `contextWindow` and add `getCatalogEntry`
**Files:** `packages/sdk/src/cost.ts`
**What to do:** Add a context-window integer field to each existing pricebook entry, sourced from public provider pages (OpenAI gpt-4o family 128k; gpt-3.5-turbo 16k; Anthropic claude-4.x + claude-3.5 family 200k; claude-3-haiku-20240307 200k; Gemini 3-flash-preview / 2.0-flash-exp / 1.5-flash 1_048_576; gemini-1.5-pro 2_097_152; mock-1 8192). Export a combined accessor returning price + context window or null. Keep existing exports byte-identical for current callers. Do not rename the file.
**Acceptance:** Task 15's test passes; existing cost tests pass.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 17 (RED): Failing test — `getEffectiveBudget` picks the minimum of default and pinned model window, tolerates unknowns
**Files:** `packages/sdk/src/__tests__/cost.test.ts`
**What to do:** Add a failing test covering: no pin returns default unchanged; pin to a known model with larger window returns default; pin to a known model with smaller window returns the model window; pin to an unknown (provider, model) returns default without throwing.
**Acceptance:** Test fails because the accessor does not exist.
**Verify:** `pnpm --filter @argus/sdk test -- cost.test.ts`.

### Task 18 (GREEN): Implement `getEffectiveBudget`
**Files:** `packages/sdk/src/cost.ts`
**What to do:** Export an accessor that returns the effective budget given a configured default and optional pinned provider + model. Consults `getCatalogEntry` and returns the min when both pin inputs are present-and-known, otherwise the configured default. Document the unknown-tolerance rule and reference HLD D4.
**Acceptance:** Task 17's test passes; existing tests pass.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 19 (RED): Failing test — `listModels()` on one adapter returns the catalog set
**Files:** `packages/sdk/src/__tests__/providers-list.test.ts`
**What to do:** Add a failing test asserting that calling `listModels()` on the mock adapter returns the mock model id set. This is the smallest possible RED to introduce the contract extension.
**Acceptance:** Test fails because `listModels` is not on the adapter contract.
**Verify:** `pnpm --filter @argus/sdk test -- providers-list.test.ts`.

### Task 20 (GREEN): Add `listModels` to `ProviderAdapter` contract and implement on mock
**Files:** `packages/sdk/src/providers/types.ts`, `packages/sdk/src/providers/mock.ts`
**What to do:** Extend the existing `ProviderAdapter` interface in `types.ts` with a synchronous accessor that returns the model ids the adapter advertises. Implement it on the mock adapter, returning the mock catalog set.
**Acceptance:** Task 19's test passes; existing SDK tests pass (other adapters will fail typecheck unless they also implement — handle in next three tasks).
**Verify:** `pnpm --filter @argus/sdk test -- providers-list.test.ts`. Typecheck will surface missing implementations and is fixed by Tasks 21/22/23 in sequence.

### Task 21 (GREEN): Implement `listModels` on the openai adapter
**Files:** `packages/sdk/src/providers/openai.ts`
**What to do:** Implement the accessor returning the gpt-4o family + gpt-3.5-turbo model ids that already appear in the pricebook.
**Acceptance:** SDK typecheck passes for the openai adapter.
**Verify:** `pnpm --filter @argus/sdk typecheck`.

### Task 22 (GREEN): Implement `listModels` on the anthropic adapter
**Files:** `packages/sdk/src/providers/anthropic.ts`
**What to do:** Implement the accessor returning the claude-4.x + claude-3.5 + claude-3-haiku model ids that appear in the pricebook.
**Acceptance:** SDK typecheck passes for the anthropic adapter.
**Verify:** `pnpm --filter @argus/sdk typecheck`.

### Task 23 (GREEN): Implement `listModels` on the gemini adapter
**Files:** `packages/sdk/src/providers/gemini.ts`
**What to do:** Implement the accessor returning the gemini-3 / 2.0 / 1.5 model ids that appear in the pricebook.
**Acceptance:** SDK typecheck passes for the gemini adapter; full SDK test suite passes.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 24 (RED): Failing test — `listConfiguredProviders` aggregates configured adapters joined with the catalog
**Files:** `packages/sdk/src/__tests__/providers-list.test.ts`
**What to do:** Add a failing test asserting the new aggregator: returns a flat list of `{ provider, model, promptPerMillion, completionPerMillion, contextWindow }` entries; only includes adapters whose `isConfigured()` is true; mock is excluded when `MOCK_PROVIDER=false` and included when `MOCK_PROVIDER=true`; models without catalog entries surface as `null` for cost + context window. Inject stubs via the helper's `opts` parameter (parallel to the existing `RouterOptions.adapters` shape).
**Acceptance:** Test fails because the aggregator does not exist.
**Verify:** `pnpm --filter @argus/sdk test -- providers-list.test.ts`.

### Task 25 (GREEN): Implement `listConfiguredProviders`
**Files:** `packages/sdk/src/providers/list.ts` (NEW)
**What to do:** Create the helper. For each configured adapter (gated by `isConfigured()`, with mock additionally gated by the `MOCK_PROVIDER` env), expand its `listModels()` and join with `getCatalogEntry`. Unknown catalog entries surface with both cost fields and the context-window field as `null` (not omitted) so the picker can render "—".
**Acceptance:** Task 24's test passes; existing tests pass.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 26 (GREEN): Re-export `listConfiguredProviders` from the SDK index
**Files:** `packages/sdk/src/index.ts`
**What to do:** Re-export the helper with a JSDoc `@internal` tag so it is consumable by `apps/api` but flagged as not part of the public SDK surface.
**Acceptance:** `apps/api` typecheck can import the helper.
**Verify:** `pnpm --filter @argus/sdk typecheck`.

---

### Task 27 (RED): Failing test — router emits a synthetic `commit` chunk exactly once on the first non-empty token
**Files:** `packages/sdk/src/__tests__/router.test.ts`
**What to do:** Add failing tests covering: a real first non-empty token triggers a commit chunk emitted immediately before it; an initial zero-length token chunk does NOT trigger commit (commit waits for the real first non-empty token); on total provider failure (no_providers_configured), no commit chunk is emitted; during failover where every real adapter fails pre-token and the router falls back to mock, commit fires for the mock adapter on its first token, not for the failed real attempts.
**Acceptance:** Tests fail because the router does not emit commit.
**Verify:** `pnpm --filter @argus/sdk test -- router.test.ts`.

### Task 28 (GREEN): Add `commit` chunk variant and emit it from the router on first non-empty token
**Files:** `packages/sdk/src/index.ts`, `packages/sdk/src/router.ts`
**What to do:** The SDK chunk union gains a new variant signaling commit; it carries the same provider/model payload the `done` chunk would carry. In the router's committed-stream wrapper, prepend a commit chunk synthesized from the chosen adapter (provider = adapter.name; model = the model already chosen for the request — defaulting to the adapter's primary model from the catalog when no pin is set). Skip the synthetic commit when the buffered first chunk is a zero-length token; drive the iterator one more step until a non-empty token or done arrives, then emit commit immediately before re-emitting the buffered non-empty token chunk. Per Preamble §1, commit carries the final provider/model — there is no later correction frame.
**Acceptance:** Task 27's tests pass; existing router tests pass; `apps/api`'s switch still compiles (the new variant is additive — the orchestrator's switch ignores `commit` until Task 32 wires it).
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 29 (RED): Failing test — router rejects or coalesces duplicate `commit` chunks (exactly-once invariant)
**Files:** `packages/sdk/src/__tests__/router.test.ts`
**What to do:** Add a failing test feeding an adapter stub whose stream defensively yields two non-empty token chunks back to back; assert the router emits exactly one commit chunk (coalesced), and that any internal commit-emission helper is idempotent if called twice in the same stream.
**Acceptance:** Test fails until the wrapper guards exactly-once emission.
**Verify:** `pnpm --filter @argus/sdk test -- router.test.ts`.

### Task 30 (GREEN): Guard the router's commit emission to exactly-once
**Files:** `packages/sdk/src/router.ts`
**What to do:** Add a single-shot guard in the committed-stream wrapper so that even if the emission helper is invoked twice in the same stream, only the first call yields a commit chunk. Document the exactly-once invariant inline and reference Preamble §2.
**Acceptance:** Task 29's test passes; Task 27's tests still pass.
**Verify:** `pnpm --filter @argus/sdk test`.

### Task 31 (RED): Failing test — override branch: success, adapter-throws, adapter-not-configured, never falls back
**Files:** `packages/sdk/src/__tests__/router.test.ts`
**What to do:** Add failing tests covering: a configured pinned adapter streams its token without walking the failover order even when other adapters are stubbed-happy; a pinned adapter that throws pre-token surfaces a `pinned_provider_unavailable` error and does NOT fall back to another adapter; a pin whose provider is not configured at all throws the same error code without invoking any adapter.
**Acceptance:** Tests fail because the router has no override branch.
**Verify:** `pnpm --filter @argus/sdk test -- router.test.ts`.

### Task 32 (GREEN): Add the override branch to the router (separate from failover loop)
**Files:** `packages/sdk/src/index.ts`, `packages/sdk/src/router.ts`
**What to do:** The SDK request type gains an optional pin field carrying provider and model strings. In the router's stream method, before the failover loop runs, branch on the pin: if absent, run the existing failover loop unchanged. If present, look up the adapter for the pinned provider; if missing or not configured, throw a provider error with code `pinned_provider_unavailable`; otherwise invoke the same first-token attempt on that one adapter only. On pre-token failure, re-wrap the underlying error as `pinned_provider_unavailable` (preserving the original code in the error message). The override branch MUST NEVER fall back to mock or another adapter. The existing `mockOnly` short-circuit beats the override branch (operators still get the keyless path). The synthetic commit chunk emission (Task 28's wrapper) runs unchanged for the override path.
**Acceptance:** Task 31's tests pass; existing failover tests are byte-identical when pin is unset.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

### Task 33 (RED): Failing test — span carries the four new attributes
**Files:** `packages/sdk/src/__tests__/otel.test.ts`
**What to do:** Add failing tests using the existing in-memory span exporter, covering: when context-budget and context-window-cap hints are passed on the request, the span exposes both as numeric attributes; when the pinned adapter throws the override-branch error, the span carries the pinned-failure attr true and the error code; when the gateway's pre-flight guess differs from the committed provider, the span carries the divergence attr true; when they match, the attr is false.
**Acceptance:** Tests fail because the attrs do not exist on the span.
**Verify:** `pnpm --filter @argus/sdk test -- otel.test.ts`.

### Task 34 (GREEN): Add new attribute constants and emit them from the SDK span lifecycle
**Files:** `packages/contracts/src/otel-attrs.ts`, `packages/sdk/src/index.ts`, `packages/sdk/src/otel.ts`
**What to do:** Add the four attribute key constants to the contracts otel-attrs module. The SDK request type gains three optional observability hints: a numeric effective budget, a numeric window cap, and a string guess-provider. On span creation, set the budget and cap attrs when present. On success, compute the divergence attr by comparing the committed provider to the seeded guess. On failure, when the error code is the override-branch code, set the pinned-failure attr true; default false.
**Acceptance:** Task 33's tests pass; existing OTel tests pass.
**Verify:** `pnpm --filter @argus/sdk test && pnpm --filter @argus/sdk typecheck`.

---

### Task 35: [non-TDD — Prisma schema change] Add `pinned_provider` + `pinned_model` columns to `conversations`
**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/0003_conversation_pin/migration.sql` (NEW directory + file)
**What to do:** Add two nullable string fields to the `Conversation` model in `schema.prisma`, both with `@map` to snake_case column names. Hand-author the migration SQL adding both columns as nullable text with no default. Module-header comment in the migration: references HLD D2, the `@map` discipline, and Argus's forward-only migration policy (rollback = ship a new forward migration that drops the columns; no down migrations). No data backfill required.
**Acceptance:** `pnpm --filter @argus/db build` regenerates the client with the new fields; `psql "$DATABASE_URL" -c '\d conversations'` shows both new columns as `text` with no default; existing migrations are untouched.
**Verify:** `pnpm --filter @argus/db build && pnpm dev:migrate` succeeds; psql confirms the columns.

---

### Task 36 (RED): Failing test — `buildMetadataFrame` produces a valid metadata frame
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Add a failing test asserting a builder helper produces an object that parses through the new metadata frame schema with the correct discriminant, messageId, seq=1, and the providerMeta passed through.
**Acceptance:** Test fails because the builder helper is missing.
**Verify:** `pnpm --filter @argus/api test -- frame-builder.test.ts`.

### Task 37 (GREEN): Add the metadata builder and update existing start/end builders
**Files:** `apps/api/src/chat/frame-builder.ts`
**What to do:** Introduce a builder helper that returns the metadata frame given messageId, seq, and providerMeta. Drop the provider/model inputs from the existing start builder (matches Task 2). Extend the existing end builder with optional context-token inputs — when both are present, embed in the returned frame; when either is missing, omit both. Inline comment notes the orchestrator gates emission to `status: 'complete'` only.
**Acceptance:** Task 36's test passes.
**Verify:** `pnpm --filter @argus/api test -- frame-builder.test.ts && pnpm --filter @argus/api typecheck`.

### Task 38 (RED): Failing test — existing start-builder test expects new shape (no provider/model)
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Update the existing start-builder happy-path test so its expected shape no longer contains provider/model. This test is expected to fail temporarily because the builder change ships but the test still asserts the old shape (or vice versa depending on order) — treat this as a deliberate RED that proves the test catches the contract drift.
**Acceptance:** Test runs and fails for the documented reason.
**Verify:** `pnpm --filter @argus/api test -- frame-builder.test.ts`.

### Task 39 (GREEN): Reconcile the start-builder test to the new shape
**Files:** `apps/api/test/chat/frame-builder.test.ts`
**What to do:** Update the assertions to expect the identity-only start frame. No production code change.
**Acceptance:** Task 38's test passes; all frame-builder tests pass.
**Verify:** `pnpm --filter @argus/api test -- frame-builder.test.ts`.

### Task 40 (RED): Failing test — orchestrator on commit emits the metadata frame in the correct sequence
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test feeding an SDK stream that yields commit → token → done. Assert the orchestrator emits the start → metadata → token → end sequence in that order; assert `seq` monotonicity; assert metadata carries the committed providerMeta from the commit chunk.
**Acceptance:** Test fails because the orchestrator does not yet handle the commit chunk.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 41 (GREEN): Wire the commit chunk handler in the orchestrator
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Remove the provider/model inputs from the orchestrator's run-stream input shape (gateway no longer passes them). When iterating the SDK stream, on a commit chunk, call the metadata builder and emit; remember the committed providerMeta on the orchestrator instance. On the done chunk, keep current behavior (capture providerMeta for the inferences-row enrichment) but DO NOT re-emit metadata — per Preamble §2, metadata is exactly once.
**Acceptance:** Task 40's test passes.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts && pnpm --filter @argus/api typecheck`.

### Task 42 (RED): Failing test — metadata frame is idempotent on duplicate commit chunks
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test feeding an SDK stream that defensively yields two commit chunks. Assert the orchestrator emits exactly one metadata frame across the stream.
**Acceptance:** Test fails until the orchestrator guards against re-emission.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 43 (GREEN): Guard the orchestrator's metadata emission to exactly-once
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Add a single-shot flag on the orchestrator instance so a second commit chunk does not produce a second metadata frame. Document the invariant inline; reference Preamble §2.
**Acceptance:** Task 42's test passes.
**Verify:** `pnpm --filter @argus/api test`.

### Task 44 (RED): Failing test — pre-token error emits no metadata frame
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test feeding an SDK stream that throws the override-branch error on the first iterator hop. Assert no metadata frame appears between start and the terminal failure end; assert the persisted message status is failed with the error code carried on the error frame.
**Acceptance:** Test fails if any metadata frame leaks before the error.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 45: [non-TDD — verification] Confirm catch-block does not call the metadata emitter
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Read the orchestrator's catch-block path and confirm metadata emission lives only inside the iterator's commit-chunk handler, never in the failure path. Add a one-line inline comment naming this LLD as the contract for "no metadata on pre-token failure" if the comment is not already present. No code change expected.
**Acceptance:** No diff in `git status` after running Task 44's test passes (production code unchanged).
**Verify:** `pnpm --filter @argus/api test`.

### Task 46 (RED): Failing test — existing start-frame orchestrator tests expect new shape
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Update existing orchestrator test cases that currently assert provider/model on the start frame so they expect the identity-only start. Migrate those assertions to the metadata frame.
**Acceptance:** Tests run and fail for the documented reason (assertions migrated; production already changed; passes are imminent).
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 47 (GREEN): Reconcile orchestrator tests to the new shape
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Finalize the test reconciliation so all chat orchestrator tests pass — no remaining test still expects provider/model on start.
**Acceptance:** Full chat test suite passes.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 48 (RED): Failing test — token-heuristic helper extracted to common module
**Files:** `apps/api/test/common/token-heuristic.test.ts` (NEW; create the `apps/api/test/common/` directory)
**What to do:** Add a failing test for a shared token-heuristic helper module (the 4-chars-per-token estimator and the configured default budget reader). Assert the estimator returns expected counts for representative inputs; assert the default-budget reader returns the env value when set and the default 10000 when unset.
**Acceptance:** Tests fail because the common module does not exist.
**Verify:** `pnpm --filter @argus/api test -- token-heuristic.test.ts`.

### Task 49 (GREEN): Extract `token-heuristic` to a shared common module
**Files:** `apps/api/src/common/token-heuristic.ts` (NEW), `apps/api/src/conversations/context-window.ts`
**What to do:** Create the new common module exporting the 4-chars-per-token estimator and the default-budget reader. Update the existing context-window module to consume from the common module rather than redefine. No behavioral change yet — pure extraction.
**Acceptance:** Task 48's tests pass; existing context-window tests pass unchanged (default still 6000 at this point).
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 50 (RED): Failing test — default context budget bumped from 6000 to 10000
**Files:** `apps/api/test/common/token-heuristic.test.ts`
**What to do:** Add a failing test asserting the default-budget reader returns 10000 when the env var is unset. This will fail because Task 49 preserved the existing 6000 default. The test names the PRD requirement explicitly.
**Acceptance:** Test fails for the documented reason.
**Verify:** `pnpm --filter @argus/api test -- token-heuristic.test.ts`.

### Task 51 (GREEN): Bump default budget to 10000 and update related fixtures
**Files:** `apps/api/src/common/token-heuristic.ts`, `apps/api/test/conversations/context-window.test.ts`
**What to do:** Change the default in the common module from 6000 to 10000. Update the existing context-window test fixtures that assert the old default. Document the cross-cutting change inline (PRD: "default context budget for a conversation is 10,000 tokens").
**Acceptance:** Task 50's test passes; existing context-window tests pass with the updated default.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

---

### Task 52 (RED): Failing test — `ChatService.startTurn` returns history excluding streaming rows, with the latest user message included
**Files:** `apps/api/test/chat/chat.service.test.ts`
**What to do:** Add a failing test asserting that with a mix of complete and streaming-status messages in conversation history, calling startTurn returns a history collection that contains the just-persisted user message and excludes any prior assistant rows still marked as streaming.
**Acceptance:** Test fails because startTurn does not yet return history nor exclude streaming rows.
**Verify:** `pnpm --filter @argus/api test -- chat.service.test.ts`.

### Task 53 (GREEN): Persist-user-first, then assemble history, return it on the start-turn result
**Files:** `apps/api/src/chat/chat.service.ts`
**What to do:** Inside the existing startTurn transaction, after inserting the user message and before returning, query messages for the conversation in chronological order filtered to non-streaming statuses (complete, canceled, failed), map to role + content, and return on the start-turn result shape. Also surface the conversation's pinned provider + pinned model on the same result so the gateway can thread them into the SDK request without a second query. Document the load-bearing ordering inline (persist user first, then read).
**Acceptance:** Task 52's test passes.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

---

### Task 54 (RED): Failing test — `ContextMeterService.compute` returns tokens-used and tokens-budget capped by pin
**Files:** `apps/api/test/chat/context-meter.service.test.ts` (NEW)
**What to do:** Add failing tests for a new injectable service covering: returns the sum of all message contents via the shared token-heuristic; returns budget equal to the configured default when no pin is set; returns the pinned model's context window when it is below the configured default; returns the configured default when the pinned (provider, model) is not in the catalog (tolerate missing entry). Inject the SDK catalog via the `SDK_CATALOG` Nest provider token; the test overrides the token with a stub.
**Acceptance:** Tests fail because the service does not exist.
**Verify:** `pnpm --filter @argus/api test -- context-meter.service.test.ts`.

### Task 55 (GREEN): Implement `ContextMeterService` and register on the chat module
**Files:** `apps/api/src/chat/context-meter.service.ts` (NEW), `apps/api/src/chat/chat.module.ts`, `apps/api/src/common/sdk-catalog.provider.ts` (NEW)
**What to do:** Implement the service as an injectable Nest provider that consumes the Prisma service and a catalog accessor injected via the `SDK_CATALOG` token. The catalog provider module exports an injection token whose value is the SDK's `listConfiguredProviders` helper plus the combined accessors (`getCatalogEntry`, `getEffectiveBudget`). The service exposes a `compute` method returning the tokens-used + tokens-budget pair given a conversation id and user id; it reads all messages for the conversation (filtered by user id, same pattern as the messages repository), sums via the shared token-heuristic, reads the conversation's pin columns, and derives the budget cap via the SDK accessor. Register the service in the chat module providers and exports.
**Acceptance:** Task 54's tests pass; existing chat tests pass.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 56 (RED): Failing test — meter throwing does not prevent the terminal `end` frame
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test injecting a meter stub that rejects on compute. Assert the orchestrator still emits the terminal end frame on the happy complete path, with both context-token fields absent (per HLD Observability).
**Acceptance:** Test fails until the orchestrator wraps the meter call in try/catch and ships end regardless.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 57 (GREEN): Wire meter into the orchestrator's complete terminal, tolerate throws
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Add the meter as an optional injected collaborator on the orchestrator's run-stream input shape (constructor-threaded via the gateway). On the complete terminal path, before building the end frame, call the meter inside try/catch; on success thread the token fields into the end frame; on failure log via the existing error-capture helper and emit end with both fields absent. Also add the user id to the run-stream input so the meter has the auth context. The failed and canceled terminal paths never call the meter.
**Acceptance:** Task 56's test passes; Task 40's test still passes and asserts the token fields are present on a happy end.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 58 (RED): Failing test — orchestrator omits token fields on failed and canceled terminals
**Files:** `apps/api/test/chat/stream-orchestrator.test.ts`
**What to do:** Add a failing test covering: when the stream ends with `status=failed`, the end frame has neither token field; when the stream ends with `status=canceled`, the end frame has neither token field; the meter is never called on either path (assert via mock).
**Acceptance:** Tests fail until the orchestrator gates the meter call to `status=complete` only.
**Verify:** `pnpm --filter @argus/api test -- stream-orchestrator.test.ts`.

### Task 59 (GREEN): Gate the meter call to `status=complete` only
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Ensure the meter is only invoked on the complete terminal path. Document inline that failed and canceled paths intentionally never count tokens (per PRD: only completed turns count).
**Acceptance:** Task 58's tests pass.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 60 (RED): Failing test — gateway reads pin columns from the conversation
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test that mocks the SDK chat.stream call to capture its argument. Send a frame against a conversation with pin columns set; assert the captured request carries the pin object with the matching provider + model strings.
**Acceptance:** Test fails because the gateway does not yet thread pin.
**Verify:** `pnpm --filter @argus/api test -- chat.gateway.test.ts`.

### Task 61 (GREEN): Gateway threads pin from the start-turn result into the SDK request
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** In the send handler, after the start-turn result returns history + pin columns (Task 53), build the SDK request including the pin object when both pin columns are non-null; absent otherwise.
**Acceptance:** Task 60's test passes.
**Verify:** `pnpm --filter @argus/api test`.

### Task 62 (RED): Failing test — gateway computes and threads effective context budget + window cap
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test asserting the captured SDK request carries an effective budget equal to the SDK accessor's output for the conversation's pin, and a window cap equal to the pinned model's catalog window (or absent / null when no pin).
**Acceptance:** Test fails until the gateway computes both.
**Verify:** `pnpm --filter @argus/api test -- chat.gateway.test.ts`.

### Task 63 (GREEN): Gateway computes effective budget and window cap from the SDK catalog accessor
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Inject the catalog provider token. Compute the effective budget and window cap via the SDK accessors using the conversation's pin and the configured default budget; thread both onto the SDK request as observability hints.
**Acceptance:** Task 62's test passes.
**Verify:** `pnpm --filter @argus/api test`.

### Task 64 (RED): Failing test — gateway threads the pre-flight `guessProvider` hint
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test asserting the captured SDK request carries a guess-provider hint equal to the first configured adapter's name per the router priority order (the head of `PROVIDER_ORDER` whose `isConfigured()` is true; or `mock` if none are configured and `MOCK_PROVIDER=true`).
**Acceptance:** Test fails until the gateway derives and threads the guess.
**Verify:** `pnpm --filter @argus/api test -- chat.gateway.test.ts`.

### Task 65 (GREEN): Gateway derives `guessProvider` from the configured-providers helper at module init
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Derive the guess by calling the catalog accessor once at module init and caching the head of the configured list per the resolution rule above. Thread it onto the SDK request.
**Acceptance:** Task 64's test passes.
**Verify:** `pnpm --filter @argus/api test`.

### Task 66 (RED): Failing test — gateway no longer passes the legacy mock provider/model literals to the orchestrator
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test asserting the orchestrator's run-stream input shape received by the gateway no longer has provider/model fields populated (they have been removed from the input shape per Task 41).
**Acceptance:** Test fails if the gateway still threads the legacy literals.
**Verify:** `pnpm --filter @argus/api test -- chat.gateway.test.ts`.

### Task 67 (GREEN): Remove the legacy `mock`/`mock-1` literals from the gateway's orchestrator construction
**Files:** `apps/api/src/chat/chat.gateway.ts`
**What to do:** Delete the now-stale literal arguments from the orchestrator construction. Pass the meter and user id (per Task 57) into the orchestrator.
**Acceptance:** Task 66's test passes; full chat test suite passes.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 68 (RED): Failing test — `pinned_provider_unavailable` lands on wire and inferences row
**Files:** `apps/api/test/chat/chat.gateway.test.ts`
**What to do:** Add a failing test feeding a pinned conversation whose pinned adapter throws the override-branch error. Assert the emitted sequence is start → error (with the error code) → end (status=failed) and that no token frames from a different provider appear (no fallback leak). Also assert the error code lands on the persisted inferences row via the existing fail-turn path.
**Acceptance:** Test fails until propagation is end-to-end.
**Verify:** `pnpm --filter @argus/api test -- chat.gateway.test.ts`.

### Task 69 (GREEN): Verify and minimally adjust error propagation
**Files:** `apps/api/src/chat/stream-orchestrator.ts`
**What to do:** Verify the existing orchestrator catch path extracts the error code from a provider error and the existing fail-turn path persists it. If anything is missing, add the minimal surface to make Task 68 pass; otherwise add one inline comment naming this LLD as the contract for `pinned_provider_unavailable` propagation.
**Acceptance:** Task 68's test passes.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 70 (RED): Failing test — `GET /providers` returns the live catalog
**Files:** `apps/api/test/providers/providers.controller.test.ts` (NEW; create the `apps/api/test/providers/` directory)
**What to do:** Add a failing test mounting the new controller via `Test.createTestingModule`, overriding the `SDK_CATALOG` token with a stub that returns a fixed payload. Assert the controller calls the stub exactly once per request and returns the payload under a `providers` key. Assert the session guard rejects unauthenticated requests (401). Do not test env gating here — that belongs to the SDK helper's tests.
**Acceptance:** Tests fail because the controller does not exist.
**Verify:** `pnpm --filter @argus/api test -- providers.controller.test.ts`.

### Task 71 (GREEN): Implement `ProvidersController` and module wiring
**Files:** `apps/api/src/providers/providers.controller.ts` (NEW), `apps/api/src/providers/providers.module.ts` (NEW), `apps/api/src/app.module.ts`
**What to do:** Implement the controller with a single GET handler returning the catalog provider's output under the `providers` key. Guard with the session guard (same pattern as the conversations controller). Implement the module importing the auth module (for the session guard) and the common module providing `SDK_CATALOG`. Register the module in the app module.
**Acceptance:** Task 70's tests pass.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 72 (RED): Failing test — `GET /providers` serializes unknown catalog entries with null cost / null context window
**Files:** `apps/api/test/providers/providers.controller.test.ts`
**What to do:** Add a failing test stubbing the catalog with one entry whose cost + context-window fields are explicitly null. Assert the response preserves the nulls under the field keys (not omitted), so the picker can render "—".
**Acceptance:** Test fails until the controller's response shape preserves nulls explicitly.
**Verify:** `pnpm --filter @argus/api test -- providers.controller.test.ts`.

### Task 73 (GREEN): Preserve null fields in the providers response shape
**Files:** `apps/api/src/providers/providers.controller.ts`
**What to do:** Ensure the controller's serialization does not strip null values from the catalog entries — null cost and null context window must round-trip to the wire.
**Acceptance:** Task 72's test passes.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 74 (RED): Failing test — `ConversationsRepository` `update` accepts pin fields
**Files:** `apps/api/test/conversations/conversations.repository.test.ts`
**What to do:** Add a failing test asserting a generalized update method on the repository accepts a partial patch including title and/or pin columns, and persists exactly the columns named in the patch (no partial writes on rejected combos).
**Acceptance:** Test fails because the repository only exposes the existing rename method.
**Verify:** `pnpm --filter @argus/api test -- conversations.repository.test.ts`.

### Task 75 (GREEN): Generalize the repository's rename into an `update` method that accepts pin fields
**Files:** `apps/api/src/conversations/conversations.repository.ts`
**What to do:** Extend the repository's row type with the two pin columns (Prisma auto-selects them after Task 35). Replace the rename method with a more general update method that accepts a partial patch and persists exactly the named columns; preserve the existing per-user authorization check.
**Acceptance:** Task 74's test passes; existing repository tests pass.
**Verify:** `pnpm --filter @argus/api test`.

### Task 76 (RED): Failing test — PATCH handler accepts valid pin combos, persists, returns 200
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test covering: PATCH with both pin fields set (and both in the live catalog) returns 200 and persists; PATCH with both pin fields null clears the pin and returns 200; PATCH combining title + pin fields updates both in one round-trip.
**Acceptance:** Tests fail until the controller wires the schema and repository.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 77 (GREEN): PATCH handler accepts the expanded schema, calls the repository, returns the DTO
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Wire the PATCH handler to parse the expanded request schema (Task 12) and call the repository's update method (Task 75) with the parsed patch. Update the DTO mapper to include the pin fields on the response (the contract was already extended in Task 14).
**Acceptance:** Task 76's tests pass.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 78 (RED): Failing test — PATCH rejects pin combos that are absent from the live catalog with `invalid_pin`
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test covering: PATCH with a pin where the model is not in the live catalog returns 400 with error code `invalid_pin`; PATCH with a pin whose provider is not configured returns 400 with the same code; on rejection, the persisted row is unchanged (re-read shows the prior pin).
**Acceptance:** Tests fail until the controller validates against the catalog.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 79 (GREEN): PATCH validates non-null pins against the live catalog before persisting
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** When the parsed patch contains non-null pin fields, look them up in the catalog provider's output; reject with 400 + `invalid_pin` if the (provider, model) pair is absent. Validate before calling the repository (no partial writes on rejection). Document the validate-then-persist ordering inline.
**Acceptance:** Task 78's tests pass.
**Verify:** `pnpm --filter @argus/api test`.

### Task 80 (RED): Failing test — `GET /conversations/:id/messages` returns context fields for unpinned conversations
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test asserting the messages list response carries tokensUsed (summed via the heuristic) and tokensBudget (the configured default) for an unpinned conversation.
**Acceptance:** Test fails until the controller calls the meter.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 81 (GREEN): Wire the meter into the messages list controller
**Files:** `apps/api/src/conversations/conversations.controller.ts`, `apps/api/src/conversations/conversations.module.ts`
**What to do:** Inject the meter into the conversations controller (export it from the chat module and import that module into the conversations module — `ContextMeterService` has no `ChatService` dependency so this direction is acyclic). In the list-messages handler, after fetching rows, call the meter inside try/catch; on success include both context fields at the response root; on failure log via the existing error-capture helper and omit both. Keep the existing omitted-count wiring unchanged.
**Acceptance:** Task 80's test passes.
**Verify:** `pnpm --filter @argus/api test && pnpm --filter @argus/api typecheck`.

### Task 82 (RED): Failing test — messages list caps `tokensBudget` at the pinned model's window
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test asserting that for a pinned conversation whose model window is below the configured default, the response's tokensBudget is the model window (not the default).
**Acceptance:** Test fails until the meter applies the pin cap end-to-end through the controller.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 83 (GREEN): Confirm the pin-cap flows end-to-end through the messages list controller
**Files:** No production code change expected — `ContextMeterService.compute` (Task 55) already applies the cap. Verify by inspection that Task 81 passed the pinned conversation to compute.
**What to do:** Read the messages-list handler and confirm the conversation id passed to the meter call is the same conversation whose pin columns are loaded. If anything is missing, add the minimal surface to make Task 82 pass; otherwise add an inline comment naming this LLD as the contract for the cap flow.
**Acceptance:** Task 82's test passes.
**Verify:** `pnpm --filter @argus/api test`.

### Task 84 (RED): Failing test — messages list omits context fields when the meter throws
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test injecting a meter that rejects on compute; assert the response still ships with the messages list but omits both context fields (resilience — server log only, never break the read).
**Acceptance:** Test fails until the controller wraps the meter call in try/catch.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 85 (GREEN): Confirm meter try/catch is in place on the messages list handler
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** Verify the try/catch from Task 81 is the same path Task 84 exercises. No new code expected — Task 81 already shipped the wrap. If anything is missing, add the minimal surface.
**Acceptance:** Task 84's test passes.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 86 (RED): Failing test — fallback resolver downgrades a no-longer-configured pin and signals the one-time notice
**Files:** `apps/api/test/conversations/conversations.controller.test.ts`
**What to do:** Add a failing test asserting that the messages list response for a conversation whose persisted pin is no longer in the live catalog: returns the conversation with both pin fields null in the response (effective view); carries a top-level boolean fallback flag and a previously-pinned object naming the dropped provider + model; does not mutate the persisted columns (a subsequent read returns the same signal). For an in-catalog pin, the fallback flag is false and the previously-pinned object is absent.
**Acceptance:** Tests fail because the resolver does not exist.
**Verify:** `pnpm --filter @argus/api test -- conversations.controller.test.ts`.

### Task 87 (RED): Failing test — messages list response schema accepts the fallback signals
**Files:** `packages/contracts/src/__tests__/conversations.test.ts`
**What to do:** Add a failing test asserting `MessageListResponseSchema` accepts an optional boolean fallback flag and an optional nested previously-pinned object (provider + model strings).
**Acceptance:** Test fails because the schema does not have these fields.
**Verify:** `pnpm --filter @argus/contracts test -- conversations.test.ts`.

### Task 88 (GREEN): Extend `MessageListResponseSchema` with the fallback signals
**Files:** `packages/contracts/src/conversations.ts`
**What to do:** Add the optional boolean fallback flag and the optional previously-pinned object (both fields, both required when present). Document inline that this is a read-time downgrade signal only.
**Acceptance:** Task 87's test passes.
**Verify:** `pnpm --filter @argus/contracts test && pnpm --filter @argus/contracts typecheck`.

### Task 89 (GREEN): Implement the fallback resolver on the messages list handler
**Files:** `apps/api/src/conversations/conversations.controller.ts`
**What to do:** After fetching the conversation row, if either pin column is non-null, consult the catalog provider's output; if the pair is absent, set the fallback flag true and surface the previously-pinned object naming the dropped pin, while returning both pin fields null in the conversation DTO portion of the response. Do not mutate the persisted columns — the next PATCH (clear or pick anew) is what writes. Document inline that this is a read-time downgrade only, and that the same resolver shape is the contract the PATCH handler validates against (Task 79).
**Acceptance:** Task 86's tests pass.
**Verify:** `pnpm --filter @argus/api test`.

---

### Task 90: [non-TDD — observability smoke] Confirm new span attrs appear in Jaeger for a real chat turn
**Files:** N/A — local infra smoke only.
**What to do:** With `pnpm dev:api` and the OTel collector + Jaeger running (via `pnpm infra:up`), send one chat turn against the mock provider and one against a pinned-unavailable adapter. Search Jaeger for the resulting spans and confirm presence of the four new attributes on the appropriate spans: budget + window cap on every span, pinned-failure true on the failure span and false on the success span, divergence flag on both.
**Acceptance:** Operator pastes a Jaeger trace URL into the PR description. The trace must show the SDK span named `llm.chat` (existing span name from `packages/sdk/src/otel.ts`) with the four attribute keys: `llm.context_budget_effective`, `llm.context_window_cap`, `llm.pinned_failure`, `llm.guess_commit_divergent`.
**Verify:** Manual — open `http://localhost:16686`, select service `argus-api`, expand the `llm.chat` span and confirm the four attribute keys.

---

## Quality Gates
- type-check: `pnpm typecheck`
- lint: `pnpm lint`
- test: `pnpm test`
- migration smoke: `pnpm --filter @argus/db build && pnpm dev:migrate`

## Dependencies
- Sibling LLD `lld-frontend-web.md` consumes the contracts changes from Tasks 2/4/6/8/10/12/14/88 and the API endpoints from Tasks 71/77/81/89. Coordinated landing as the backbone PR is binding per HLD §Sequencing.
- The Prisma migration (Task 35) ships inside the backbone PR — `apps/api` reads the new columns from Task 53 onward and would break a deployment that lacked the migration.
- Task 49 (token-heuristic extraction) is a prerequisite for Task 55 (`ContextMeterService`). Task 51 (default budget bump) MUST land in the backbone PR — the frontend's context meter assumes the new default and breaks visually under the old.
