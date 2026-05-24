---
phase: lld
status: APPROVED
slug: chat-context-and-ux-polish
created: 2026-05-24T17:36:50Z
updated: 2026-05-24T19:50:00Z
---

# LLD: frontend-web — Chat UX, Multi-Turn Context, and Provider Surface

## Preamble — Cross-LLD Coordination

This LLD covers only the `apps/web` portion of the feature. The sibling LLD
`lld-backend-api.md` covers contracts, SDK, and API gateway. Coordination
rules (binding):

- **One coordinated backbone PR.** HLD Sequencing requires the discriminated-
  union change to land atomically across contracts → API → web reducer. This
  LLD's Tasks 1–14 (reducer + history-hydration changes that consume the new
  frame and expanded `end` shape) MUST ship in the same PR as the backend
  LLD's contracts + orchestrator + frame-builder tasks. Coordinate Task 1 of
  both LLDs.
- **Follow-up PRs are independent.** Tasks 15+ here (`MessageContent`,
  `ProviderPicker`, `ContextMeter`, focus hook, sanitize module, picker
  empty-state, Markdown switch on `MessageList`, Playwright specs) ship as
  separate PRs and may interleave with the backend LLD's follow-ups
  (`ProvidersController`, `ContextMeterService`, PATCH validation).
- **Markdown rendering on `MessageList` is a one-way door per HLD Decision 7.**
  Reviewer must verify the sanitize policy against the inventory in Decision
  7 explicitly. Once shipped, rollback is costly even if technically
  reversible. The same PR regenerates the affected Playwright snapshots and
  the `MessageList` test fixtures whose whitespace/line-break expectations
  change under react-markdown.

## Locked Contracts (source of truth from the frontend's perspective)

These are the literal shapes the web code is built against. The sibling
backend LLD is authoritative for the wire format; if the backend lands a
different shape during the coordinated backbone PR, fix both LLDs in lock-
step.

### Metadata frame semantics

- The `commit` chunk from the SDK carries the FINAL provider + model — the
  committed adapter knows its own model identifier. No "provisional" values
  pass through `start`.
- The metadata frame is emitted **EXACTLY ONCE per turn**, sourced from the
  `commit` chunk. Field shape (TypeScript hints for understanding only — the
  zod schema lives in `packages/contracts`):
  - `type: 'metadata'`
  - `messageId: string`
  - `seq: number` (integer ≥ 1; canonical position `start@0 → metadata@1 →
    token@2..N → terminal`)
  - `providerMeta: { provider: string; model: string }` (open-shaped per HLD
    D1 — extra fields are allowed and ignored by the web reducer)
- **No correction frame, no re-emission.** The `done` / `end` chunk does NOT
  change provider/model; those are locked at metadata-frame time.
- Pre-token failure path: no `commit` → no metadata frame → `start` → `error`
  → `end (failed)`. The streaming chip transitions ellipsis-direct-to-failure
  without ever displaying a provider name.

### Endpoint paths

- **Provider catalog:** `GET /api/providers`. Response body is an object with
  a single `providers` array; each entry has fields `provider` (string),
  `model` (string), `promptPerMillion` (number or null), `completionPerMillion`
  (number or null), and `contextWindow` (number or null). The backend SDK
  helper returns one row per `(provider, model)` pair; the web `ProviderPicker`
  groups by provider client-side. `null` cost or context-window means "unknown
  — render em-dash placeholder".
- **Conversation pin set/clear:** `PATCH /api/conversations/:id` with body
  `{ pinnedProvider?: string | null, pinnedModel?: string | null }`. Both
  fields are optional; both `null` clears the pin (Auto-switch path);
  validation errors return 4xx and are surfaced as `ApiError` from
  `authFetch` unchanged.

### Cost format (PRD)

- Canonical format: `$0.15 / $0.60 per 1M` (prompt cost slash completion
  cost, USD per million tokens; print whatever decimals come out of the
  pricebook value, no padding).
- Unknown cost (either side `null`): render `—` per side or `—` for the
  whole pair when both are absent.

### Empty-state copy (no providers configured)

- Inline trigger label: `No providers configured — set OPENAI_API_KEY,
  ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.`
- Env var names are spelled exactly: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  `GOOGLE_API_KEY`.

### E2E mock identifiers

- The multi-turn (CI-safe) E2E spec selects `mock` / `mock-1` from the
  picker — these are the stable identifiers the existing mock adapter
  exposes via `listModels()`.

## Builder
**agent:** frontend-web-worker
**model:** opus

## Reviewer (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** see `~/.claude/skills/oh/prompts/builder-addendum.md`

## Tester (cross-model — REQUIRED different lineage)
**mechanism:** `oh-cross-model --model codex`
**framing:** test-writer agent assembles the test plan; codex designs the
actual tests via the wrapper. For Playwright non-TDD specs, codex authors
selectors and assertions but the worker runs them against the live compose
stack.

## Scope Boundary

In scope (this LLD): every file under `apps/web/`.

Out of scope (sibling LLD): `packages/contracts/`, `packages/sdk/`,
`packages/db/`, `apps/api/`. Where a task here consumes a new contract type
or REST field, the test mocks the shape per the locked contracts above —
the tests assert behaviour against the agreed shape, not against the backend
implementation.

---

## Tasks

> Test path convention follows the existing repo layout:
> `apps/web/__tests__/lib/<module>.test.ts` and
> `apps/web/__tests__/components/<Component>.test.tsx`. The instructions
> referenced `apps/web/lib/__tests__/` but the repo already uses the root
> `__tests__` mirror for every existing web test — staying with the
> established convention.

### Block A — Backbone PR: reducer + history hydration (coordinate with backend Task 1)

#### Task 1 (RED): Failing test — metadata frame writes provider/model onto the streaming bubble
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches a `metadata` frame action carrying `providerMeta.provider` and `providerMeta.model` for the active streaming `messageId`. Behavior covered: metadata action sets provider and model on the streaming bubble; does not mutate content; does not change `lastAppliedSeq`.
**Acceptance:** Test exists; runs; fails because the metadata case is not yet handled in `applyFrame`.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/message-stream-reducer.test.ts` reports the new test as failing.

#### Task 2 (GREEN): Reducer handles metadata frame — writes provider/model onto streaming bubble
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Add a new branch to `applyFrame` for the metadata frame discriminant that updates `state.streaming.provider` and `state.streaming.model` when the frame's `messageId` matches the active streaming bubble; ignore when there is no matching streaming bubble.
**Acceptance:** Task 1's test passes; existing reducer tests stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/message-stream-reducer.test.ts` is clean.

#### Task 3 (RED): Failing test — `start` frame creates a provisional streaming bubble without provider/model
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches a `start` frame. Behavior covered: start action creates a provisional streaming bubble without provider or model, with empty content and the correct message id.
**Acceptance:** Test fails because `applyStart` still reads `frame.provider` / `frame.model`.
**Verify:** Same test command reports the new test as failing.

#### Task 4 (GREEN): `applyStart` stops reading provider/model from the start frame
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Remove the provider/model reads from `applyStart` so the streaming bubble is created without those fields populated; do not break any other start-frame behaviour.
**Acceptance:** Task 3 passes; all earlier reducer tests stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/message-stream-reducer.test.ts` is clean.

#### Task 5 (RED): Failing test — metadata frame replay is idempotent
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches the same metadata frame twice. Behavior covered: metadata replay is idempotent (no state change on repeated dispatch with identical payload).
**Acceptance:** Test fails because the naive implementation builds a fresh object each time.
**Verify:** Same test command reports the new test as failing.

#### Task 6 (GREEN): Metadata-frame handler short-circuits on identical payload
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Guard the metadata branch so when the streaming bubble's provider and model already equal the incoming frame's values, the reducer treats the dispatch as a no-op.
**Acceptance:** Task 5 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 7 (RED): Failing test — metadata for a mismatched `messageId` is ignored
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches a metadata frame whose `messageId` does NOT match the active streaming bubble. Behavior covered: reducer makes no state change; no provider/model leaks onto the active streaming bubble; no warning thrown.
**Acceptance:** Test fails if the reducer blindly writes onto the active streaming bubble.
**Verify:** Same test command reports the new test as failing.

#### Task 8 (GREEN): Metadata is gated on matching `messageId`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Guard the metadata branch with an id-match check; otherwise no-op.
**Acceptance:** Task 7 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 9 (RED): Failing test — metadata for an already-terminal message is ignored
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches a metadata frame after the message has been promoted via an `end` frame. Behavior covered: late metadata does not mutate the promoted message in `state.messages`; no warning thrown.
**Acceptance:** Test fails if reducer rummages through `state.messages` and writes there.
**Verify:** Same test command reports the new test as failing.

#### Task 10 (GREEN): Metadata is gated on the streaming bubble existing
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Guard the metadata branch so it only acts when `state.streaming` is present; messages already promoted to `state.messages` are not reached.
**Acceptance:** Task 9 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 11 (RED): Failing test — completed promoted message preserves provider/model learned via metadata
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test: dispatch `start` → `metadata(provider=X, model=Y)` → tokens → `end(status=complete)`. Behavior covered: the promoted message in `state.messages` carries provider X and model Y.
**Acceptance:** Test fails if `applyEnd` drops the streaming bubble's provider/model on promotion.
**Verify:** Same test command reports the new test as failing.

#### Task 12 (GREEN): `applyEnd` carries provider/model through promotion
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** When promoting the streaming bubble to `state.messages`, copy `streaming.provider` and `streaming.model` onto the promoted message.
**Acceptance:** Task 11 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 13 (RED): Failing test — metadata replay does NOT change `lastAppliedSeq`
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that asserts `lastAppliedSeq` is unchanged after a metadata dispatch (whether first dispatch or replay). Behavior covered: metadata frames do not participate in the seq-monotonicity tracking that token/end frames use.
**Acceptance:** Test fails if the metadata branch updates `lastAppliedSeq`.
**Verify:** Same test command reports the new test as failing.

#### Task 14 (GREEN): Metadata branch leaves `lastAppliedSeq` alone
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Confirm the metadata branch does not touch `lastAppliedSeq`; remove any incidental write if present.
**Acceptance:** Task 13 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 15 (RED): Failing test — metadata arriving BEFORE `start` is discarded
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches a metadata frame when `state.streaming` is `null` (no prior `start`). Policy: discard (do not buffer); reducer returns same state reference. Behavior covered: a stray pre-start metadata frame is ignored without affecting any subsequent legitimate sequence.
**Acceptance:** Test fails if the reducer throws or mutates state when streaming is null.
**Verify:** Same test command reports the new test as failing.

#### Task 16 (GREEN): Discard policy for pre-start metadata
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** The metadata branch's "no streaming bubble" guard from Task 10 already covers this; add a one-line comment naming the discard policy and Task 15 so future readers don't accidentally introduce buffering.
**Acceptance:** Task 15 passes; earlier reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 17 (RED): Failing test — `end` frame hydrates `tokensUsed` / `tokensBudget` on `status=complete`
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add a failing test that dispatches an `end` frame with `status: 'complete'` carrying `tokensUsed` and `tokensBudget`. Behavior covered: the promoted message in `state.messages` exposes both numeric fields verbatim from the frame.
**Acceptance:** Test fails because `applyEnd` does not yet copy those fields onto the promoted message.
**Verify:** Same test command reports the new test as failing.

#### Task 18 (GREEN): `applyEnd` copies `tokensUsed` / `tokensBudget` for completed turns
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Extend the exported `Message` type with two optional numeric fields for tokens-used and tokens-budget; in `applyEnd`, when `frame.status === 'complete'`, copy those two fields from the frame onto the promoted message.
**Acceptance:** Task 17 passes; existing end-frame tests stay green.
**Verify:** Same test command is clean.

#### Task 19 (RED): Failing test — `end` frame for failed/canceled turns does NOT carry tokens fields
**Files:** `apps/web/__tests__/lib/message-stream-reducer.test.ts`
**What to do:** Add two failing tests (one each for `status: 'failed'` and `status: 'canceled'`). Behavior covered: both token fields are absent (strictly undefined) on the promoted message regardless of what the frame carries.
**Acceptance:** Tests fail because the naive Task 18 implementation may copy fields when present regardless of status.
**Verify:** Same test command reports both new tests as failing.

#### Task 20 (GREEN): Tokens-field copy is gated on `status === 'complete'`
**Files:** `apps/web/lib/message-stream-reducer.ts`
**What to do:** Adjust the Task 18 logic so the two token fields are only copied onto the promoted message when `frame.status === 'complete'`; otherwise leave both undefined.
**Acceptance:** Task 19's tests pass; all reducer tests stay green.
**Verify:** Same test command is clean.

#### Task 21 (RED): Failing test — `useConversationHistory` hydrates `tokensUsed` / `tokensBudget` from the REST messages-list response
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test that mocks `authFetch` to return a messages-list response whose final assistant message DTO includes `tokensUsed` and `tokensBudget`. Behavior covered: the hook's `ready` snapshot exposes both fields on the corresponding mapped `Message`.
**Acceptance:** Test fails because `toReducerMessage` does not yet read those fields.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/use-conversation-history.test.ts` reports the new test as failing.

#### Task 22 (GREEN): `toReducerMessage` copies token fields from DTO to reducer Message
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Extend `toReducerMessage` so when the DTO includes the tokens fields it copies them onto the returned `Message`; leave undefined otherwise. Do not change cache, fetch, or state-machine behaviour.
**Acceptance:** Task 21 passes; existing hook tests stay green.
**Verify:** Same test command is clean.

#### Task 23 (RED): Failing test — `useConversationHistory` surfaces `pinFallbackNotice` flag in `ready`
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test that mocks the messages-list response with a top-level `pinFallbackNotice` payload (carrying the previously-pinned provider and model strings). Behavior covered: the hook's `ready` snapshot exposes the notice payload at a documented field name (`pinFallbackNotice`) so `MessageComposer` can render the inline notice on first paint.
**Acceptance:** Test fails because the hook does not yet surface the notice.
**Verify:** Same test command reports the new test as failing.

#### Task 24 (GREEN): Hook surfaces `pinFallbackNotice` in its `ready` snapshot
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Extend the `ConversationHistoryState` `ready` variant with an optional `pinFallbackNotice` field; populate it from the REST response.
**Acceptance:** Task 23 passes; existing hook tests stay green.
**Verify:** Same test command is clean.

#### Task 25 (RED): Failing test — `pinFallbackNotice` survives in the module-scope cache across rerenders
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test that primes the conversation cache with a notice payload, renders the hook, unmounts, remounts; behavior covered: the second mount's `ready` snapshot still carries the notice without a refetch.
**Acceptance:** Test fails because the cache layer does not yet preserve the notice.
**Verify:** Same test command reports the new test as failing.

#### Task 26 (GREEN): Cache preserves the notice across hook lifecycle
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Extend the existing module-scope conversation cache entry to include the notice; populate on first fetch; read on rehydrate.
**Acceptance:** Task 25 passes; existing hook tests stay green.
**Verify:** Same test command is clean.

#### Task 27 (RED): Failing test — exported `clearPinFallbackNotice(conversationId)` helper removes the notice for that conversation only
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test that primes two conversations with notices, calls the new helper for one of them, then renders the hook for each. Behavior covered: the cleared conversation's `ready` snapshot has `pinFallbackNotice` absent; the other conversation's notice is untouched.
**Acceptance:** Test fails because the helper does not exist.
**Verify:** Same test command reports the new test as failing.

#### Task 28 (GREEN): Export `clearPinFallbackNotice` from `use-conversation-history.ts`
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Export a `clearPinFallbackNotice(conversationId: string): void` that mutates the cache entry for that conversation by removing the notice field. Document the contract in a JSDoc one-liner.
**Acceptance:** Task 27 passes; existing tests stay green.
**Verify:** Same test command is clean.

#### Task 29 (RED): Failing test — `clearPinFallbackNotice` does NOT wipe messages or omittedCount
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test that primes a conversation with messages, an `omittedCount`, and a notice; calls the clear helper; remounts. Behavior covered: messages and omittedCount are preserved; only the notice is gone.
**Acceptance:** Test fails if the helper rewrites the cache entry rather than mutating only the notice field.
**Verify:** Same test command reports the new test as failing.

#### Task 30 (GREEN): Helper preserves messages and omittedCount
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Refine the helper from Task 28 to only delete/null the notice field on the cache entry; do not rewrite the entry.
**Acceptance:** Task 29 passes; Tasks 27–28 stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/use-conversation-history.test.ts` is clean.

#### Task 31 (RED): Failing test — absence of `pinFallbackNotice` in the response leaves `ready.pinFallbackNotice` undefined
**Files:** `apps/web/__tests__/lib/use-conversation-history.test.ts`
**What to do:** Add a failing test mocking a messages-list response without the notice field. Behavior covered: `ready.pinFallbackNotice` is strictly `undefined`; cache entry has no stale notice carried over from a prior conversation.
**Acceptance:** Test fails if the hydrate logic accidentally copies a stale value.
**Verify:** Same test command reports the new test as failing.

#### Task 32 (GREEN): Hydrate logic does not invent a notice when absent
**Files:** `apps/web/lib/use-conversation-history.ts`
**What to do:** Ensure the hydrate path only sets the notice when the response carries it.
**Acceptance:** Task 31 passes; earlier hook tests stay green.
**Verify:** Same test command is clean.

---

### Block B — Sanitize module (independent follow-up)

#### Task 33 (RED): Failing test — `sanitizeMarkdown` strips `javascript:` URLs from anchor `href`
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add a failing test that runs the sanitize pipeline over Markdown containing a link whose `href` is a `javascript:` URL. Behavior covered: `javascript:` links are stripped (href absent) or rewritten to a sanitize-safe placeholder.
**Acceptance:** Test fails because the module does not yet exist.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/sanitize-markdown.test.ts` reports import failure.

#### Task 34 (GREEN): Create `sanitize-markdown` module — strips `javascript:` URLs
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Create a pure module that exports a sanitize-schema config compatible with `rehype-sanitize` and a small helper that takes a string and returns the sanitised rendered HTML for use in tests; the URL allow-list rejects `javascript:` entirely.
**Acceptance:** Task 33 passes.
**Verify:** Same test command is clean.

#### Task 35 (RED): Failing tests — `sanitizeMarkdown` strips `data:` and `vbscript:` URLs
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add two failing tests (one for `data:` URL in `href`, one for `vbscript:` URL in `href`). Behavior covered: both schemes are stripped.
**Acceptance:** Tests fail if the Task 34 allow-list permits either scheme.
**Verify:** Same test command reports the new tests as failing.

#### Task 36 (GREEN): Allow-list rejects `data:` and `vbscript:`
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Restrict the sanitize URL scheme allow-list to exactly the locked set: **allowed** = `http`, `https`, `mailto`, protocol-relative `//`, relative paths, hash `#`; **stripped** = `javascript:`, `data:`, `vbscript:`. Both `href` (anchors) and `src` (images) go through the same allow-list.
**Acceptance:** Task 35 passes.
**Verify:** Same test command is clean.

#### Task 37 (RED): Failing tests — mixed-case dangerous schemes are stripped
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add failing tests for `JaVaScRiPt:`, `DATA:`, and `VbScRiPt:` URLs in `href`. Behavior covered: scheme matching is case-insensitive; all three are stripped.
**Acceptance:** Tests fail if the allow-list compares schemes case-sensitively.
**Verify:** Same test command reports the new tests as failing.

#### Task 38 (GREEN): Scheme matching is case-insensitive
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Normalise scheme comparison to lower-case in the URL allow-list (or delegate to a rehype-sanitize built-in that already does so).
**Acceptance:** Task 37 passes; Tasks 33–36 stay green.
**Verify:** Same test command is clean.

#### Task 39 (RED): Failing tests — whitespace/control-character obfuscation in dangerous URLs is stripped
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add failing tests for `java\tscript:`, `java\nscript:`, and a leading-space variant in `href`. Behavior covered: tab/newline/leading-whitespace within or before the scheme does not bypass the allow-list; URLs are stripped.
**Acceptance:** Tests fail if the allow-list naively matches the scheme prefix.
**Verify:** Same test command reports the new tests as failing.

#### Task 40 (GREEN): Strip whitespace/control characters before scheme comparison
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Pre-trim and strip control characters from the URL before extracting the scheme; reject any URL whose normalised scheme is in the deny-list.
**Acceptance:** Task 39 passes; earlier sanitizer tests stay green.
**Verify:** Same test command is clean.

#### Task 41 (RED): Failing test — image URLs follow the same scheme allow/deny rules
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add a failing test rendering Markdown with two images — one with an `https:` `src` (should survive), one with a `javascript:` `src` (should be stripped). Behavior covered: image scheme policy mirrors anchor scheme policy.
**Acceptance:** Test fails if image `src` is not allow-listed (or is permissively allow-listed).
**Verify:** Same test command reports the new test as failing.

#### Task 42 (GREEN): Image `src` uses the same allow-list as `href`
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Extend the sanitize schema so the `img.src` attribute passes through the same URL allow/deny pipeline.
**Acceptance:** Task 41 passes; earlier sanitizer tests stay green.
**Verify:** Same test command is clean.

#### Task 43 (RED): Failing test — `http`, `https`, `mailto`, protocol-relative, relative, and hash links survive
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add failing tests (one block, parameterised by scheme) covering each allowed scheme. Behavior covered: each link's `href` survives the pipeline.
**Acceptance:** Tests fail if the over-restrictive allow-list from earlier tasks drops any allowed scheme.
**Verify:** Same test command reports the new tests as failing.

#### Task 44 (GREEN): Sanitize permits the full allowed scheme set
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Confirm the allow-list permits the locked allowed-scheme set; adjust without re-opening the dangerous schemes.
**Acceptance:** Task 43's tests pass; Tasks 33–42 stay green.
**Verify:** Same test command is clean.

#### Task 45 (RED): Failing test — raw HTML in the sanitizer input is stripped at the module level
**Files:** `apps/web/__tests__/lib/sanitize-markdown.test.ts`
**What to do:** Add a failing test that feeds the helper a Markdown string containing raw `<script>` and raw `<iframe>` tags. Behavior covered: neither tag appears in the rendered output; the sanitizer schema is the line of defence.
**Acceptance:** Test fails if the schema permits either tag.
**Verify:** Same test command reports the new test as failing.

#### Task 46 (GREEN): Sanitize schema rejects raw `<script>`, `<iframe>`, and other unsafe tags
**Files:** `apps/web/lib/sanitize-markdown.ts`
**What to do:** Ensure the schema's tag allow-list contains only the elements `react-markdown`'s own renderers produce (headings, paragraphs, lists, code, table, anchor, image, etc.); raw HTML tags not in the list are stripped.
**Acceptance:** Task 45 passes.
**Verify:** Same test command is clean.

---

### Block C — Composer focus hook (independent follow-up)

#### Task 47 (RED): Failing test — `useFocusComposer` focuses the ref'd textarea on mount
**Files:** `apps/web/__tests__/lib/use-focus-composer.test.ts`
**What to do:** Add a failing test that renders a tiny host component using the hook with a textarea ref. Behavior covered: textarea is the active element after the initial render.
**Acceptance:** Test fails because the hook does not yet exist.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/use-focus-composer.test.ts` reports import failure.

#### Task 48 (GREEN): Create `useFocusComposer` — focuses on mount
**Files:** `apps/web/lib/use-focus-composer.ts`
**What to do:** Create the hook that accepts a textarea ref and the inputs needed for the other triggers (a `streaming` boolean, a `disabled` boolean, and a `conversationId`); on mount, focus the ref'd element.
**Acceptance:** Task 47 passes.
**Verify:** Same test command is clean.

#### Task 49 (RED): Failing test — re-focuses after the streaming-lock releases
**Files:** `apps/web/__tests__/lib/use-focus-composer.test.ts`
**What to do:** Add a failing test that toggles `streaming` from `true` to `false`. Behavior covered: textarea regains focus on the falling edge.
**Acceptance:** Test fails because the hook does not re-focus on lock release yet.
**Verify:** Same test command reports the new test as failing.

#### Task 50 (GREEN): Re-focus on lock release
**Files:** `apps/web/lib/use-focus-composer.ts`
**What to do:** Add an effect that runs when the lock signal transitions from `true` to `false` and focuses the ref'd element.
**Acceptance:** Task 49 passes; Task 47 stays green.
**Verify:** Same test command is clean.

#### Task 51 (RED): Failing test — focuses on `conversationId` change
**Files:** `apps/web/__tests__/lib/use-focus-composer.test.ts`
**What to do:** Add a failing test that changes the `conversationId` prop from `null` to a UUID (and again to a different UUID). Behavior covered: focus lands on the textarea after each id change.
**Acceptance:** Test fails because the hook does not yet react to id changes.
**Verify:** Same test command reports the new test as failing.

#### Task 52 (GREEN): Re-focus on `conversationId` change
**Files:** `apps/web/lib/use-focus-composer.ts`
**What to do:** Add an effect keyed on `conversationId` that focuses the ref'd element on every change.
**Acceptance:** Task 51 passes; earlier tests stay green.
**Verify:** Same test command is clean.

#### Task 53 (RED): Failing test — does NOT steal focus mid-stream
**Files:** `apps/web/__tests__/lib/use-focus-composer.test.ts`
**What to do:** Add a failing test that focuses a sibling element while `streaming` is `true`. Behavior covered: focus stays on the sibling; the hook does not yank focus back to the textarea while the stream is in flight.
**Acceptance:** Test fails if the Task 50 effect fires on each render rather than only on the lock-release transition.
**Verify:** Same test command reports the new test as failing.

#### Task 54 (GREEN): Lock-release effect fires only on `true → false` edge
**Files:** `apps/web/lib/use-focus-composer.ts`
**What to do:** Track the previous lock value via a ref and only refocus on the falling edge; do not refocus on any render where the lock is still `true`.
**Acceptance:** Task 53 passes; Tasks 49–52 stay green.
**Verify:** Same test command is clean.

#### Task 55 (RED): Failing test — does not refocus on every render
**Files:** `apps/web/__tests__/lib/use-focus-composer.test.ts`
**What to do:** Add a failing test that after the hook's initial mount focus, simulates a user click on a sibling button while the composer is idle (no lock release, no id change). Behavior covered: focus stays on the sibling.
**Acceptance:** Test fails if any effect refocuses on every render.
**Verify:** Same test command reports the new test as failing.

#### Task 56 (GREEN): Effects do not refocus outside the documented triggers
**Files:** `apps/web/lib/use-focus-composer.ts`
**What to do:** Verify only the three documented effects (mount, lock-release edge, id change) call `focus()`; remove any extra refocus paths.
**Acceptance:** Task 55 passes; all earlier tests stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/use-focus-composer.test.ts` is clean.

---

### Block D — Providers REST client (independent follow-up)

#### Task 57 (RED): Failing test — `fetchProviderCatalog` calls `GET /api/providers` and returns the parsed payload
**Files:** `apps/web/__tests__/lib/providers-api.test.ts`
**What to do:** Add a failing test that mocks `authFetch` to return a sample catalog payload matching the locked response shape. Behavior covered: helper calls `authFetch` with path `/api/providers`, method GET, no body; returns the parsed shape unchanged.
**Acceptance:** Test fails because the module does not exist.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/providers-api.test.ts` reports import failure.

#### Task 58 (GREEN): Create `providers-api` module — catalog fetch helper
**Files:** `apps/web/lib/providers-api.ts`
**What to do:** Create the module with a typed catalog-fetch helper that calls `authFetch` against `/api/providers`; describe the returned shape via a TypeScript type alias.
**Acceptance:** Task 57 passes.
**Verify:** Same test command is clean.

#### Task 59 (RED): Failing test — `patchConversationPin(id, { provider, model })` issues a PATCH with the correct body
**Files:** `apps/web/__tests__/lib/providers-api.test.ts`
**What to do:** Add a failing test that calls the set helper. Behavior covered: `authFetch` is invoked with path `/api/conversations/:id`, method `PATCH`, and a body matching `{ pinnedProvider: 'openai', pinnedModel: 'gpt-4o-mini' }`. The body is passed via `authFetch`'s `body` option (the helper does not pre-stringify; serialization is owned by `authFetch`).
**Acceptance:** Test fails because the helper does not exist.
**Verify:** Same test command reports the new test as failing.

#### Task 60 (GREEN): `patchConversationPin` set path
**Files:** `apps/web/lib/providers-api.ts`
**What to do:** Add the pin-set helper that issues the PATCH; pass the body object through `authFetch`'s `body` option (let `authFetch` own serialization).
**Acceptance:** Task 59 passes.
**Verify:** Same test command is clean.

#### Task 61 (RED): Failing test — `patchConversationPin` rethrows `ApiError` on 4xx
**Files:** `apps/web/__tests__/lib/providers-api.test.ts`
**What to do:** Add a failing test that mocks `authFetch` to throw `ApiError` (e.g. 400 `invalid_pin`). Behavior covered: the helper does not swallow or wrap the error; the same `ApiError` instance propagates to the caller.
**Acceptance:** Test fails if the helper catches or rewraps `ApiError`.
**Verify:** Same test command reports the new test as failing.

#### Task 62 (GREEN): Set helper propagates `ApiError` unchanged
**Files:** `apps/web/lib/providers-api.ts`
**What to do:** Confirm there is no try/catch around the `authFetch` call; let `ApiError` propagate.
**Acceptance:** Task 61 passes; earlier provider-api tests stay green.
**Verify:** Same test command is clean.

#### Task 63 (RED): Failing test — `clearConversationPin(id)` PATCHes with both pin fields null
**Files:** `apps/web/__tests__/lib/providers-api.test.ts`
**What to do:** Add a failing test that calls `clearConversationPin(conversationId)`. Behavior covered: `authFetch` is invoked with the PATCH body `{ pinnedProvider: null, pinnedModel: null }`; body goes through `authFetch`'s `body` option, not pre-stringified.
**Acceptance:** Test fails because the clear helper is missing.
**Verify:** Same test command reports the new test as failing.

#### Task 64 (GREEN): `clearConversationPin` (Auto switch)
**Files:** `apps/web/lib/providers-api.ts`
**What to do:** Add the pin-clear helper that issues the PATCH with both pin fields nulled; same body-option pattern as Task 60.
**Acceptance:** Task 63 passes.
**Verify:** Same test command is clean.

#### Task 65 (RED): Failing test — `clearConversationPin` rethrows `ApiError` on 4xx
**Files:** `apps/web/__tests__/lib/providers-api.test.ts`
**What to do:** Same as Task 61 but for the clear helper. Behavior covered: `ApiError` propagates unchanged.
**Acceptance:** Test fails if the helper swallows the error.
**Verify:** Same test command reports the new test as failing.

#### Task 66 (GREEN): Clear helper propagates `ApiError` unchanged
**Files:** `apps/web/lib/providers-api.ts`
**What to do:** Confirm no try/catch around the `authFetch` call for the clear path.
**Acceptance:** Task 65 passes.
**Verify:** `pnpm --filter @argus/web test __tests__/lib/providers-api.test.ts` is clean.

---

### Block E — Markdown rendering (one-way door — coordinate snapshot regen)

#### Task 67: [non-TDD — package.json dependency addition] Add react-markdown, remark-gfm, rehype-sanitize
**Files:** `apps/web/package.json`, `pnpm-lock.yaml`
**What to do:** Add the three packages as runtime dependencies pinned to their current majors: `react-markdown@^9`, `remark-gfm@^4`, `rehype-sanitize@^6`. Worker confirms the exact published version available via `pnpm add` at install time; the major must match those ranges. Do NOT add `rehype-raw`. Without `rehype-raw`, `react-markdown` escapes raw HTML by default — which is what we want; the sanitizer plus default escaping form defense-in-depth.
**Acceptance:** `pnpm install` completes cleanly; `pnpm --filter @argus/web typecheck` succeeds; the three packages appear under `dependencies` in `apps/web/package.json`; `rehype-raw` is absent from `dependencies` and `devDependencies`.
**Verify:** `pnpm install && pnpm --filter @argus/web typecheck`.

#### Task 68 (RED): Failing tests — `MessageContent` renders headings, bold, italic, lists, inline code, fenced code, GFM tables, and GFM task lists from Markdown
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add failing RTL tests (one block, parameterised per construct) that render `MessageContent` with assistant-role content covering each PRD-scoped construct. Behavior covered: headings, bold, italic, lists, inline code, fenced code, GFM tables, and GFM task lists each render as their expected semantic HTML element.
**Acceptance:** Tests fail because the component does not exist.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageContent.test.tsx` reports import failure.

#### Task 69 (GREEN): Create `MessageContent` — assistant rows render via react-markdown + remark-gfm + rehype-sanitize
**Files:** `apps/web/components/chat/MessageContent.tsx`
**What to do:** Create a presentational component that takes the message role and content, plus an optional `isStreaming` flag, and renders assistant content through react-markdown wired with `remark-gfm` and `rehype-sanitize` (using the schema from `sanitize-markdown.ts`); user-role content renders as plain text in a span so it stays inert.
**Acceptance:** Task 68 passes; the component does not introduce React warnings during the test run.
**Verify:** Same test command is clean.

#### Task 70 (RED): Failing test — user-role messages render as inert plain text (no Markdown processing)
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add a failing test that renders `MessageContent` with `role="user"` and content that contains Markdown syntax (e.g. `**bold**`, `[link](https://x)`). Behavior covered: the rendered output contains the literal asterisks and brackets as text; no `<strong>` or `<a>` elements appear.
**Acceptance:** Test fails if the component routes user content through react-markdown.
**Verify:** Same test command reports the new test as failing.

#### Task 71 (GREEN): User role bypasses Markdown rendering
**Files:** `apps/web/components/chat/MessageContent.tsx`
**What to do:** Confirm the role-branch in Task 69 emits user content as a plain `<span>`; do not pass user content to react-markdown.
**Acceptance:** Task 70 passes; Tasks 68–69 stay green.
**Verify:** Same test command is clean.

#### Task 72 (RED): Failing test — partial Markdown (mid-stream snapshot) renders without crashing
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add a failing test that renders `MessageContent` with intentionally truncated Markdown source (e.g. an open fenced-code block with no closer, an unfinished `[label](` link, an open table row). Behavior covered: the component renders without throwing and emits visible text content from the partial input.
**Acceptance:** Test fails if the implementation throws on any truncated input.
**Verify:** Same test command reports the new test as failing or erroring.

#### Task 73 (GREEN): Streaming-safe partial-Markdown rendering
**Files:** `apps/web/components/chat/MessageContent.tsx`
**What to do:** Rely on `react-markdown`'s built-in resilience to partial input (it does not throw on incomplete syntax). Do NOT wrap the rendered tree in a try/catch — try/catch in JSX does not catch render-time errors. If a defensive error boundary is genuinely warranted, implement it as a separate `MessageContentErrorBoundary` class component following React's error-boundary pattern and document the rationale inline; otherwise omit the boundary.
**Acceptance:** Task 72 passes; Tasks 68–71 stay green.
**Verify:** Same test command is clean.

#### Task 74 (RED): Failing test — assistant raw-HTML in content renders as inert text, not interpreted HTML
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add a failing test that renders `MessageContent` with assistant content containing a raw `<script>` tag and a raw `<img>` tag. Behavior covered: neither element appears in the DOM; the literal HTML characters appear as visible text instead.
**Acceptance:** Test fails if rehype-sanitize is not stripping raw HTML.
**Verify:** Same test command reports the new test as failing.

#### Task 75 (GREEN): Sanitize schema strips raw HTML at the component layer
**Files:** `apps/web/components/chat/MessageContent.tsx`, `apps/web/lib/sanitize-markdown.ts`
**What to do:** Confirm the sanitize schema rejects raw HTML tag names except those react-markdown's own renderers produce; adjust the schema if the default permits anything from Task 74's input. (Without `rehype-raw`, the raw HTML is escaped before the rehype pipeline runs — the sanitizer is the second line of defence.)
**Acceptance:** Task 74 passes; existing sanitize tests in Block B stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageContent.test.tsx __tests__/lib/sanitize-markdown.test.ts` is clean.

#### Task 76 (RED): Failing test — external links rendered through `MessageContent` get `target="_blank"` and `rel="noopener noreferrer"`
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add a failing test that renders Markdown with a link to a different origin (e.g. `https://example.com/x`). Behavior covered: the rendered anchor has both `target="_blank"` and `rel="noopener noreferrer"`. (`rehype-sanitize` does NOT add these itself; they come from a custom `components.a` renderer in the `react-markdown` config — or from a `rehype` link-target plugin — that this task wires.)
**Acceptance:** Test fails because no custom renderer is wired.
**Verify:** Same test command reports the new test as failing.

#### Task 77 (GREEN): Custom anchor renderer adds new-tab attributes to external links
**Files:** `apps/web/components/chat/MessageContent.tsx`
**What to do:** Pass a `components.a` renderer to `react-markdown` (or wire an equivalent rehype plugin) that detects anchors whose `href` is absolute http/https with a different origin than `window.location.origin` (SSR: treat all absolute http/https as external) and emits the anchor with `target="_blank"` and `rel="noopener noreferrer"`.
**Acceptance:** Task 76 passes.
**Verify:** Same test command is clean.

#### Task 78 (RED): Failing test — same-origin links do NOT get `target="_blank"`
**Files:** `apps/web/__tests__/components/MessageContent.test.tsx`
**What to do:** Add a failing test rendering Markdown with a link to the same origin (mock `window.location.origin` for the assertion). Behavior covered: the anchor has neither `target="_blank"` nor `rel="noopener noreferrer"`.
**Acceptance:** Test fails if the Task 77 renderer blindly tags every absolute URL.
**Verify:** Same test command reports the new test as failing.

#### Task 79 (GREEN): Custom anchor renderer discriminates same-origin from external
**Files:** `apps/web/components/chat/MessageContent.tsx`
**What to do:** Refine the renderer so same-origin absolute URLs render as plain in-app links without new-tab attributes; external still gets them.
**Acceptance:** Task 78 passes; Tasks 76–77 stay green.
**Verify:** Same test command is clean.

#### Task 80 (RED): Failing test — copy action on a rendered assistant message copies the original Markdown source
**Files:** `apps/web/__tests__/components/MessageList.test.tsx`
**What to do:** Add a failing test that renders a `MessageList` containing an assistant message with Markdown content (`**bold**`), simulates the copy-action click, and asserts the clipboard write receives the raw Markdown source — not the rendered HTML or text. Use the existing clipboard mock pattern from the existing copy-action tests.
**Acceptance:** Test fails if the copy action grabs `innerText` of the rendered DOM instead of `message.content`.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageList.test.tsx` reports the new test as failing.

#### Task 81 (GREEN): Copy action sources clipboard text from `message.content` after Markdown rendering lands
**Files:** `apps/web/components/chat/MessageList.tsx`
**What to do:** Verify the existing copy-action handler still reads `message.content` (the raw Markdown source) and not the rendered DOM; adjust if the integration in Task 83 inadvertently changed the source.
**Acceptance:** Task 80 passes; existing copy-action tests stay green.
**Verify:** Same test command is clean.

#### Task 82: [non-TDD — visual rendering integration] Wire `MessageContent` into `MessageList` assistant rows
**Files:** `apps/web/components/chat/MessageList.tsx`
**What to do:** Replace the plain-text rendering inside the `AssistantMessage` body (the `<div>` currently rendering `{message.content}`) with `<MessageContent role="assistant" content={message.content} />`; keep all other markup (meta row, hover actions, retry button, status markers) unchanged.
**Acceptance:** `apps/web/__tests__/components/MessageList.test.tsx` stays green after updating any whitespace-sensitive assertions that change shape under react-markdown; the test suite stays green.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageList.test.tsx`.

#### Task 83: [non-TDD — visual rendering integration] Wire `MessageContent` into `MessageStream` streaming bubble
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Replace the `{streaming.content || …}` plain-text body inside the streaming bubble with `<MessageContent role="assistant" content={streaming.content} isStreaming />`; keep the caret span as a sibling so the streaming-blink visual continues to render.
**Acceptance:** `apps/web/__tests__/components/MessageStream.test.tsx` stays green (or is updated in the same PR for any text-rendering assertions that change shape).
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageStream.test.tsx`.

#### Task 84: [non-TDD — Playwright fixture] Seed a deterministic Markdown response in the mock provider for the rendering spec
**Files:** `apps/web/__tests__/fixtures/markdown-payload.md` (text file used by both the unit and e2e suites) OR an addition to the mock provider's seed map at `packages/sdk/src/providers/mock.ts` keyed by a known prompt
**What to do:** Add a fixture so that when the e2e spec sends a known prompt (e.g. "render the demo markdown"), the mock provider returns a deterministic Markdown payload covering one example of each PRD-scoped construct (heading, bold, italic, list, inline code, fenced code, table, task list). If the mock adapter already keys responses by prompt, add this prompt; otherwise add a one-off short-circuit in the mock keyed on a sentinel prompt string. Worker picks the cleanest insertion point.
**Acceptance:** Sending the sentinel prompt via the live mock stack reliably yields the seeded Markdown payload; the payload renders cleanly through `MessageContent` (verified manually once).
**Verify:** Manual: `pnpm dev`, send the sentinel prompt, observe the rendered bubble matches the fixture content semantically.

#### Task 85: [non-TDD — Playwright page object] Extend `ChatPage` with helpers for the rendered assistant bubble's terminal state
**Files:** `tests/e2e/pages/ChatPage.ts`
**What to do:** Add page-object methods that the rendering spec needs: a selector for "the latest assistant bubble", a `waitForTerminalState()` that waits until the streaming caret is gone and the chip shows a provider, and a snapshot helper that targets the rendered bubble's content region (not the meta row).
**Acceptance:** The new page-object methods are exported and typed; nothing else changes; existing specs stay green.
**Verify:** `pnpm --filter @argus/e2e test` (existing specs).

#### Task 86: [non-TDD — Playwright screenshot diff] `markdown-rendering.spec.ts`
**Files:** `tests/e2e/specs/markdown-rendering.spec.ts`
**What to do:** Add the spec: sign in as `demo@argus.dev` / `let-me-in-9`, send the sentinel prompt from Task 84, wait for terminal state via the Task 85 helper, take a screenshot of the rendered assistant bubble matched against a committed Playwright snapshot (`toHaveScreenshot`). Let Playwright pick the snapshot filename — the runner auto-suffixes with project/platform and writes into the snapshot directory it manages; do NOT hard-code a snapshot path.
**Acceptance:** Spec passes against the live compose stack with `MOCK_PROVIDER=true`; spec is green on a clean rerun.
**Verify:** `pnpm --filter @argus/e2e test specs/markdown-rendering.spec.ts`.

#### Task 87: [non-TDD — snapshot baseline commit] Commit the Playwright baseline snapshot for `markdown-rendering.spec.ts`
**Files:** Whichever snapshot directory Playwright wrote into during Task 86's first run (typically `tests/e2e/specs/markdown-rendering.spec.ts-snapshots/` or the project-suffixed variant — follow whatever convention any existing repo snapshot uses)
**What to do:** Run the spec once with `--update-snapshots` (or the repo's equivalent), inspect the produced screenshot visually for sanity, and commit the baseline.
**Acceptance:** Baseline is committed; re-running the spec without `--update-snapshots` is green.
**Verify:** `pnpm --filter @argus/e2e test specs/markdown-rendering.spec.ts` after the commit.

#### Task 88: [non-TDD — snapshot regen housekeeping] Re-record `tests/e2e/specs/chat.spec.ts-snapshots/` if affected
**Files:** Any snapshots under `tests/e2e/specs/chat.spec.ts-snapshots/` whose bubble content now flows through Markdown
**What to do:** Run the existing chat spec; if Playwright reports diffs against the committed snapshots, re-record those specific snapshot files only. Do not touch unrelated snapshots.
**Acceptance:** Affected snapshots updated in one isolated commit; full Playwright suite green.
**Verify:** `pnpm e2e`.

#### Task 89: [non-TDD — snapshot regen housekeeping] Re-record `tests/e2e/specs/auth.spec.ts-snapshots/` if affected
**Files:** Any snapshots under `tests/e2e/specs/auth.spec.ts-snapshots/` if (unlikely but possible) the auth flow surfaces an assistant message
**What to do:** Run the existing auth spec; if Playwright reports diffs, re-record only the affected snapshot files; otherwise note in the PR description that this spec was unaffected.
**Acceptance:** Either snapshots updated or PR description notes the spec was unaffected; full Playwright suite green.
**Verify:** `pnpm e2e`.

#### Task 90: [non-TDD — jest fixture regen] Update `MessageList.test.tsx` whitespace-sensitive assertions
**Files:** `apps/web/__tests__/components/MessageList.test.tsx`
**What to do:** Audit existing assertions in this file that match assistant content verbatim against raw Markdown source (e.g. asserting on `**bold**` as a string match). Replace each with assertions that match the rendered semantic shape (e.g. asserting on the presence of a `<strong>` element with the inner text "bold"). Do not change any unrelated assertions.
**Acceptance:** Test file passes against the integrated `MessageContent` from Task 82.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageList.test.tsx`.

#### Task 91: [non-TDD — jest fixture regen] Update `MessageStream.test.tsx` whitespace-sensitive assertions
**Files:** `apps/web/__tests__/components/MessageStream.test.tsx`
**What to do:** Same audit as Task 90 against the streaming-bubble tests. Replace verbatim string matches with semantic shape matches.
**Acceptance:** Test file passes against the integrated `MessageContent` from Task 83.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageStream.test.tsx`.

---

### Block F — `ContextMeter` UI (independent follow-up)

#### Task 92 (RED): Failing test — `ContextMeter` renders the fraction with the unit when both fields are present
**Files:** `apps/web/__tests__/components/ContextMeter.test.tsx`
**What to do:** Add a failing test that renders `ContextMeter` with `tokensUsed=8200` and `tokensBudget=10000`. Behavior covered: visible text reads `8.2k / 10k tokens` (PRD format).
**Acceptance:** Test fails because the component does not exist.
**Verify:** `pnpm --filter @argus/web test __tests__/components/ContextMeter.test.tsx` reports import failure.

#### Task 93 (GREEN): Create `ContextMeter` — renders fraction with unit
**Files:** `apps/web/components/chat/ContextMeter.tsx`
**What to do:** Create a presentational component that accepts `tokensUsed` and `tokensBudget` (both `number | null | undefined`) and renders the PRD format when both are present, with a small numeric formatter that produces the `8.2k` style suffix for values ≥ 1000.
**Acceptance:** Task 92 passes.
**Verify:** Same test command is clean.

#### Task 94 (RED): Failing tests — `ContextMeter` renders nothing when budget is 0 or tokens-used is null/undefined
**Files:** `apps/web/__tests__/components/ContextMeter.test.tsx`
**What to do:** Add three failing tests: `tokensBudget=0`, `tokensUsed=null`, `tokensUsed=undefined`. Behavior covered: each renders `null` (or empty output that the chat surface can `display: none` without layout shift).
**Acceptance:** Tests fail unless guards are added.
**Verify:** Same test command reports the new tests as failing.

#### Task 95 (GREEN): `ContextMeter` guards on missing inputs
**Files:** `apps/web/components/chat/ContextMeter.tsx`
**What to do:** Return `null` when budget is 0 or tokens-used is null/undefined.
**Acceptance:** Task 94 passes; Tasks 92–93 stay green.
**Verify:** Same test command is clean.

#### Task 96 (RED): Failing test — `ContextMeter` host (in `MessageStream`) sources tokens from the last completed assistant message, ignoring failed/canceled rows
**Files:** `apps/web/__tests__/components/MessageStream.test.tsx`
**What to do:** Add a failing test that renders `MessageStream` with `state.messages` containing, in order: a completed assistant message with `tokensUsed=5000, tokensBudget=10000`, then a failed assistant message (no tokens), then a canceled assistant message (no tokens). Behavior covered: the `ContextMeter` displays `5k / 10k tokens` — sourced from the last *completed* assistant row, not the literally-last row.
**Acceptance:** Test fails because the selection logic does not yet exist.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageStream.test.tsx` reports the new test as failing.

#### Task 97 (GREEN): `MessageStream` mounts `ContextMeter` with last-completed-assistant selection
**Files:** `apps/web/components/chat/MessageStream.tsx`
**What to do:** Render `ContextMeter` near the top of the conversation column (above `MessageList`, below the `OmittedIndicator` slot). Source `tokensUsed`/`tokensBudget` from the most-recent assistant message in `state.messages` whose status is `complete` (skip failed/canceled). Fall back to the hydrated values from `useConversationHistory` on first paint of a resumed conversation. **Placement decision (binding for v1):** `MessageStream` owns this because `MessageStream` already owns reducer state — mounting in `ChatSurface` would require lifting state and churns more files. Trade-off: if context-meter state ever needs to be shared with sibling surfaces (e.g. a header chip), placement should move to `ChatSurface`; that migration is out of scope for v1.
**Acceptance:** Task 96 passes.
**Verify:** Same test command is clean.

#### Task 98: [non-TDD — visual sanity] Confirm `ContextMeter` appears on the chat page after a turn completes
**Files:** None (manual verification)
**What to do:** Run the live stack, sign in, send one message, confirm the meter appears with the fraction once the stream completes; confirm no layout shift when the meter is hidden (no completed assistant message yet).
**Acceptance:** Manual smoke passes; screenshot attached to PR description.
**Verify:** `pnpm dev`, sign in as `demo@argus.dev` / `let-me-in-9`, send one message.

---

### Block G — `ProviderPicker` UI (independent follow-up)

> **ARIA / keyboard pattern (binding for this LLD).** `ProviderPicker` follows
> the WAI-ARIA 1.2 combobox-with-listbox pattern. Trigger is a `button` with
> `role="combobox"` and `aria-expanded` reflecting open/closed; the dropdown
> panel uses `role="listbox"`; each model row uses `role="option"`. Keyboard:
> ArrowDown opens the dropdown and focuses the first option; ArrowUp/Down
> navigate options; Enter selects the focused option (closes the dropdown);
> Escape closes the dropdown and returns focus to the trigger. Outside-click
> closes the dropdown without selection. If `apps/web/components/` already
> exports a generic dropdown/listbox primitive, the worker reuses it;
> otherwise the worker implements the pattern inline using semantic elements
> and the documented handlers.

#### Task 99 (RED): Failing test — `ProviderPicker` shows "Auto" as the default selection when no pin is set
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders `ProviderPicker` with no `pinnedProvider` / `pinnedModel` props. Behavior covered: the trigger's accessible name reads "Auto".
**Acceptance:** Test fails because the component does not exist.
**Verify:** `pnpm --filter @argus/web test __tests__/components/ProviderPicker.test.tsx` reports import failure.

#### Task 100 (GREEN): Create `ProviderPicker` — trigger renders Auto as default
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Create the component shell with a trigger button (`role="combobox"`, `aria-expanded="false"`, accessible name "Auto" when no pin is set). Accept a catalog prop (the shape returned by `fetchProviderCatalog`), `pinnedProvider` / `pinnedModel` / `onPin` / `onClear` / `streaming` props for the rest of the behaviour.
**Acceptance:** Task 99 passes.
**Verify:** Same test command is clean.

#### Task 101 (RED): Failing test — `ProviderPicker` shows the current pinned label when a pin is set
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders the picker with `pinnedProvider="openai"`, `pinnedModel="gpt-4o-mini"`, and a catalog that contains that pair. Behavior covered: the trigger's accessible name reads a label that includes both the provider and the model identifier (e.g. `openai · gpt-4o-mini` — exact separator and casing are at the worker's discretion as long as both identifiers appear).
**Acceptance:** Test fails because the trigger label is hard-coded to "Auto".
**Verify:** Same test command reports the new test as failing.

#### Task 102 (GREEN): Trigger label reflects the current pin
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Compute the trigger label from `pinnedProvider`/`pinnedModel` when present; fall back to "Auto" when both are null/undefined.
**Acceptance:** Task 101 passes.
**Verify:** Same test command is clean.

#### Task 103 (RED): Failing test — `ProviderPicker` falls back to "Auto" label when pinned model is missing from the catalog
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders the picker with `pinnedProvider="openai"`, `pinnedModel="ghost-model-not-in-catalog"`. Behavior covered: trigger label reads "Auto" (the pin is stale; the picker pretends Auto is in effect until the user picks again).
**Acceptance:** Test fails if the picker shows the stale pin label.
**Verify:** Same test command reports the new test as failing.

#### Task 104 (GREEN): Stale-pin fallback in the label computer
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** When computing the trigger label, verify the pinned `(provider, model)` pair exists in the catalog. If not, treat as Auto for label purposes.
**Acceptance:** Task 103 passes; earlier picker tests stay green.
**Verify:** Same test command is clean.

#### Task 105 (RED): Failing test — opening the dropdown lists every configured provider grouped, with per-model cost shown inline
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that simulates a trigger click on a `ProviderPicker` whose catalog has two configured providers (each with multiple models, each with a per-million-token prompt/completion pair). Behavior covered: open menu shows each provider as a group heading and each model as an option row whose accessible name contains the cost formatted as `$0.15 / $0.60 per 1M`.
**Acceptance:** Test fails because open behaviour and model rows are not yet implemented.
**Verify:** Same test command reports the new test as failing.

#### Task 106 (GREEN): Dropdown opens, lists grouped providers + models with costs
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Implement the dropdown open/close state, render the catalog grouped by provider (group headings), and surface each model's prompt/completion cost in the row label per the locked format.
**Acceptance:** Task 105 passes.
**Verify:** Same test command is clean.

#### Task 107 (RED): Failing test — model rows whose cost is unknown render "—" in place of cost
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test where the catalog entry for one model has `promptPerMillion: null` and `completionPerMillion: null`. Behavior covered: that model's row shows the em-dash placeholder instead of a missing/blank cost.
**Acceptance:** Test fails because the formatter does not yet emit the placeholder.
**Verify:** Same test command reports the new test as failing.

#### Task 108 (GREEN): Unknown-cost rows show em-dash
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Adjust the cost formatter so missing cost renders as `—`.
**Acceptance:** Task 107 passes; Tasks 105–106 stay green.
**Verify:** Same test command is clean.

#### Task 109 (RED): Failing test — selecting a non-Auto entry invokes `onPin` with the chosen provider+model
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that opens the dropdown, clicks a specific model row. Behavior covered: `onPin` is invoked with the provider and model identifiers exactly as they appear in the catalog; the dropdown closes.
**Acceptance:** Test fails because the click handler is not wired.
**Verify:** Same test command reports the new test as failing.

#### Task 110 (GREEN): Row click wires to `onPin`
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Wire the row click handler to invoke `onPin(provider, model)` and close the dropdown.
**Acceptance:** Task 109 passes.
**Verify:** Same test command is clean.

#### Task 111 (RED): Failing test — selecting "Auto" while a pin is set invokes `onClear`
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders the picker with a current pin, clicks the "Auto" entry in the open dropdown. Behavior covered: `onClear` is invoked; dropdown closes.
**Acceptance:** Test fails because Auto-click is not wired.
**Verify:** Same test command reports the new test as failing.

#### Task 112 (GREEN): Auto-row click wires to `onClear`
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Wire the Auto row's click handler to `onClear()`; when there is no pin to clear, the Auto row may be omitted from the dropdown or rendered as a no-op (worker decides; behaviour just needs to be idempotent).
**Acceptance:** Task 111 passes.
**Verify:** Same test command is clean.

#### Task 113 (RED): Failing tests — keyboard navigation: ArrowDown opens, ArrowUp/Down navigate, Enter selects, Escape closes and returns focus
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add failing tests, one per interaction, against a picker with at least two options:
- ArrowDown on the focused trigger opens the dropdown and moves focus to the first option.
- ArrowDown/ArrowUp on an option moves focus to the next/previous option (wraps at the boundaries — pick wrap-around as the v1 policy).
- Enter on a focused option invokes `onPin` with that option's `(provider, model)` and closes the dropdown.
- Escape on an open dropdown closes it and returns focus to the trigger.
Behavior covered: full keyboard accessibility per the documented ARIA pattern.
**Acceptance:** Tests fail because key handlers are not wired.
**Verify:** Same test command reports the new tests as failing.

#### Task 114 (GREEN): Wire the keyboard handlers per the ARIA pattern
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Implement the key handlers described in Task 113 against the listbox + option structure; manage focus via refs (or a generic primitive if one exists in the repo).
**Acceptance:** Task 113's tests pass; earlier picker tests stay green.
**Verify:** Same test command is clean.

#### Task 115 (RED): Failing test — picker is disabled while `streaming` is true
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders the picker with `streaming=true`. Behavior covered: trigger has `aria-disabled="true"` (or equivalent `disabled` attribute); clicking the trigger does not open the dropdown.
**Acceptance:** Test fails because the disabled handling is not wired.
**Verify:** Same test command reports the new test as failing.

#### Task 116 (GREEN): Streaming gates the picker
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Respect the `streaming` prop to disable the trigger and prevent open transitions; surface the disabled state via `aria-disabled` and a visual treatment consistent with the design's disabled tokens.
**Acceptance:** Task 115 passes.
**Verify:** Same test command is clean.

#### Task 117 (RED): Failing test — empty-state (no providers configured) shows the disabled env-var label and does NOT open
**Files:** `apps/web/__tests__/components/ProviderPicker.test.tsx`
**What to do:** Add a failing test that renders the picker with an empty catalog (zero configured providers). Behavior covered: the trigger renders a disabled label reading `No providers configured — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.` (the locked copy); clicking the trigger does NOT open a dropdown.
**Acceptance:** Test fails because the empty-state branch is not yet handled.
**Verify:** Same test command reports the new test as failing.

#### Task 118 (GREEN): Empty-state branch — disabled label, no open
**Files:** `apps/web/components/chat/ProviderPicker.tsx`
**What to do:** Add the empty-state branch: when the catalog is empty, render a disabled trigger whose label is the locked copy and short-circuit the open handler.
**Acceptance:** Task 117 passes; Tasks 99–116 stay green.
**Verify:** `pnpm --filter @argus/web test __tests__/components/ProviderPicker.test.tsx` is clean.

---

### Block G2 — `ChatSurface` owns catalog data + pin state; threads to `MessageComposer`

> **Ownership decision (binding).** `ChatSurface` owns catalog fetching and
> the pin state machine; `MessageComposer` stays presentational and receives
> the catalog + current pin + onPin/onClear callbacks as props. Mixing IO
> into the composer is rejected per repo convention.

#### Task 119 (RED): Failing test — `ChatSurface` fetches the catalog on mount via `fetchProviderCatalog` and surfaces `loading` then `ready`
**Files:** `apps/web/__tests__/components/ChatSurface.test.tsx`
**What to do:** Add a failing test that mocks `providers-api.fetchProviderCatalog` and renders `ChatSurface`. Behavior covered: during the in-flight fetch the catalog state is `loading`; after resolve the catalog state is `ready` with the resolved catalog payload; `MessageComposer` is rendered with the catalog as a prop in the `ready` state.
**Acceptance:** Test fails because the fetch state machine does not yet exist in `ChatSurface`.
**Verify:** `pnpm --filter @argus/web test __tests__/components/ChatSurface.test.tsx` reports the new test as failing.

#### Task 120 (GREEN): `ChatSurface` catalog fetch state machine
**Files:** `apps/web/components/chat/ChatSurface.tsx`
**What to do:** Add a small `useEffect`-driven fetch on mount that calls `fetchProviderCatalog`, tracks `idle | loading | ready | error` in local state, and passes the catalog down to `MessageComposer` once `ready`.
**Acceptance:** Task 119 passes; existing `ChatSurface` tests stay green.
**Verify:** Same test command is clean.

#### Task 121 (RED): Failing test — `ChatSurface` surfaces `error` state on catalog fetch failure and renders a non-blocking notice
**Files:** `apps/web/__tests__/components/ChatSurface.test.tsx`
**What to do:** Add a failing test that mocks `fetchProviderCatalog` to reject. Behavior covered: the chat surface still renders (composer + message list); a non-blocking inline notice surfaces somewhere near the composer naming the catalog as unavailable; `ProviderPicker` falls back to the empty-state branch (effectively disabled).
**Acceptance:** Test fails if the error path crashes or surfaces nothing.
**Verify:** Same test command reports the new test as failing.

#### Task 122 (GREEN): Catalog error state renders gracefully
**Files:** `apps/web/components/chat/ChatSurface.tsx`
**What to do:** On fetch rejection, set the state machine to `error`, surface a small inline notice near the composer, and pass an empty catalog into `MessageComposer` so the picker uses its empty-state branch.
**Acceptance:** Task 121 passes; Tasks 119–120 stay green.
**Verify:** Same test command is clean.

#### Task 123 (RED): Failing test — `ChatSurface` exposes `pinnedProvider`/`pinnedModel` to `MessageComposer` from `useConversationHistory`
**Files:** `apps/web/__tests__/components/ChatSurface.test.tsx`
**What to do:** Add a failing test that primes `useConversationHistory` cache with a conversation that has `pinnedProvider`/`pinnedModel` set. Behavior covered: `MessageComposer` receives those values as props.
**Acceptance:** Test fails because `ChatSurface` does not yet thread pin state down.
**Verify:** Same test command reports the new test as failing.

#### Task 124 (GREEN): Thread pin state from `useConversationHistory` to `MessageComposer`
**Files:** `apps/web/components/chat/ChatSurface.tsx`, `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Extend `useConversationHistory.ready` to also expose `pinnedProvider`/`pinnedModel` (if not already), read them in `ChatSurface`, and pass them down as props to `MessageComposer`. `MessageComposer` accepts them as new props and forwards to `ProviderPicker`.
**Acceptance:** Task 123 passes; earlier `ChatSurface` and composer tests stay green.
**Verify:** Same test command is clean.

#### Task 125 (RED): Failing test — `MessageComposer` mounts `ProviderPicker` and wires `onPin` to `patchConversationPin`
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that renders `MessageComposer` with a catalog prop and stubs `providers-api.patchConversationPin`. Simulate the picker's row-click. Behavior covered: `patchConversationPin` is called once with `(conversationId, { provider, model })`; the local pin state reflects the new selection optimistically.
**Acceptance:** Test fails because the picker is not yet mounted in the composer.
**Verify:** `pnpm --filter @argus/web test __tests__/components/MessageComposer.test.tsx` reports the new test as failing.

#### Task 126 (GREEN): Mount `ProviderPicker` inside `MessageComposer` and wire `onPin`
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Replace the static `auto-failover` + `N provider configured` pills with `<ProviderPicker>` wired to: catalog prop, current pin from the new props, `onPin={(provider, model) => patchConversationPin(conversationId, { pinnedProvider: provider, pinnedModel: model })}`, `streaming` from the existing prop.
**Acceptance:** Task 125 passes.
**Verify:** Same test command is clean.

#### Task 127 (RED): Failing test — `MessageComposer` wires `onClear` to `clearConversationPin`
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that simulates the picker's Auto-click while a pin is set. Behavior covered: `clearConversationPin` is called once with `conversationId`; the local pin state reflects the cleared pin optimistically.
**Acceptance:** Test fails because the clear wiring is missing.
**Verify:** Same test command reports the new test as failing.

#### Task 128 (GREEN): Wire `onClear` to `clearConversationPin`
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Pass `onClear={() => clearConversationPin(conversationId)}` to the picker.
**Acceptance:** Task 127 passes.
**Verify:** Same test command is clean.

#### Task 129 (RED): Failing test — `MessageComposer` rolls back the optimistic pin and surfaces an `ApiError` toast/inline notice on PATCH failure
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that stubs `patchConversationPin` to reject with `ApiError`. Behavior covered: the optimistic pin state reverts to the previous value; an inline error notice surfaces near the picker (or uses the existing toast system if the repo has one); subsequent interaction with the picker works as before.
**Acceptance:** Test fails because the error path is not handled.
**Verify:** Same test command reports the new test as failing.

#### Task 130 (GREEN): Optimistic-pin rollback + inline error on PATCH failure
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Wrap the `onPin` / `onClear` handlers so that on `ApiError` the optimistic state reverts and an inline notice renders near the picker. Use whatever toast/notice primitive the repo already uses; otherwise inline a small dismissible notice.
**Acceptance:** Task 129 passes; Tasks 125–128 stay green.
**Verify:** Same test command is clean.

#### Task 131: [non-TDD — manual verification] Pin persists across refresh in the live stack
**Files:** None (manual verification)
**What to do:** Run the live stack, sign in, open the picker, pick a model, refresh the page, confirm the pin survives (the trigger label reflects the selection on first paint of the refreshed page).
**Acceptance:** Manual smoke passes; screenshot of the picker trigger label pre- and post-refresh attached to PR description.
**Verify:** `pnpm dev`, sign in as `demo@argus.dev` / `let-me-in-9`, pick a model, refresh, observe.

---

### Block G3 — Inline "previously-pinned model unavailable" notice

#### Task 132 (RED): Failing test — `MessageComposer` reads `pinFallbackNotice` from props and renders an inline notice
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that renders `MessageComposer` with a `pinFallbackNotice` prop populated (carrying the previously-pinned provider and model strings). Behavior covered: an inline notice appears above the composer body naming the previously-pinned provider/model.
**Acceptance:** Test fails because the composer does not yet read or render the notice.
**Verify:** Same test command reports the new test as failing.

#### Task 133 (GREEN): Render the inline notice from `pinFallbackNotice` prop
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Accept a new `pinFallbackNotice` prop (optional). When present, render an inline notice region above the composer body whose copy names the previously-pinned provider/model.
**Acceptance:** Task 132 passes.
**Verify:** Same test command is clean.

#### Task 134 (RED): Failing test — `ChatSurface` threads `pinFallbackNotice` from `useConversationHistory` to `MessageComposer`
**Files:** `apps/web/__tests__/components/ChatSurface.test.tsx`
**What to do:** Add a failing test that primes the hook's cache with a `pinFallbackNotice` payload. Behavior covered: `MessageComposer` receives the notice as a prop on mount.
**Acceptance:** Test fails because `ChatSurface` does not yet thread the notice.
**Verify:** Same test command reports the new test as failing.

#### Task 135 (GREEN): Thread `pinFallbackNotice` from hook to composer
**Files:** `apps/web/components/chat/ChatSurface.tsx`
**What to do:** Read `pinFallbackNotice` from `useConversationHistory.ready`; pass through to `MessageComposer`.
**Acceptance:** Task 134 passes.
**Verify:** Same test command is clean.

#### Task 136 (RED): Failing test — dismissing the notice calls `clearPinFallbackNotice` and removes the notice from the DOM
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that renders the composer with the notice prop, clicks the dismiss control, and asserts (a) the notice is no longer in the DOM, (b) `clearPinFallbackNotice` was called once with the `conversationId`.
**Acceptance:** Test fails because no dismiss control is wired.
**Verify:** Same test command reports the new test as failing.

#### Task 137 (GREEN): Wire dismiss control to `clearPinFallbackNotice`
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Add a dismiss control (button with an accessible label like "Dismiss notice") to the inline notice; on click, call the `clearPinFallbackNotice` helper from `use-conversation-history.ts` with `conversationId` and hide the notice locally (cache update propagates on next render via the hook).
**Acceptance:** Task 136 passes.
**Verify:** Same test command is clean.

#### Task 138 (RED): Failing test — re-rendering the composer for the same conversation after dismissal does not re-show the notice
**Files:** `apps/web/__tests__/components/MessageComposer.test.tsx`
**What to do:** Add a failing test that primes the notice, dismisses, forces a re-render. Behavior covered: the notice stays hidden across the re-render (the cache mutation persists).
**Acceptance:** Test fails if dismissal is local-only without invoking the cache helper.
**Verify:** Same test command reports the new test as failing.

#### Task 139 (GREEN): Dismissal persists via the cache helper
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Confirm the cache helper from Task 137 is the sole source of truth; remove any redundant local "hidden" state that would re-show on next render.
**Acceptance:** Task 138 passes; Tasks 132–137 stay green.
**Verify:** Same test command is clean.

---

### Block H — Focus hook integration and streaming-chip provisional state

#### Task 140: [non-TDD — focus hook integration] Wire `useFocusComposer` into `MessageComposer`
**Files:** `apps/web/components/chat/MessageComposer.tsx`
**What to do:** Use `useFocusComposer({ ref: taRef, streaming, disabled, conversationId })` (composer receives `conversationId` as a new prop from `ChatSurface` for this).
**Acceptance:** Manual keyboard-only flow: on initial load, focus is in the composer; after send, focus returns automatically; navigating to a saved conversation lands focus in the composer.
**Verify:** Manual click-through via `pnpm dev`.

#### Task 141 (RED): Failing test — streaming chip shows `assistant · …` while no metadata frame has arrived
**Files:** `apps/web/__tests__/components/MessageStream.test.tsx`
**What to do:** Add a failing test that drives the reducer through `start` only (no metadata frame yet). Behavior covered: the streaming bubble's meta row renders the chip as `assistant` followed by an ellipsis placeholder; no provider name is rendered yet.
**Acceptance:** Test fails because the ellipsis placeholder is not yet wired.
**Verify:** Same test command reports the new test as failing.

#### Task 142 (GREEN): Add the ellipsis placeholder while provider is undefined
**Files:** `apps/web/components/chat/MessageList.tsx` (`MessageMeta` component)
**What to do:** When `MessageMeta` renders a row whose `message.provider` is undefined and whose role is `assistant`, append a visible ellipsis placeholder next to "assistant" so the chip is clearly in a provisional state rather than just empty.
**Acceptance:** Task 141 passes.
**Verify:** Same test command is clean.

#### Task 143 (RED): Failing test — streaming chip swaps the ellipsis for the provider name when the metadata frame arrives
**Files:** `apps/web/__tests__/components/MessageStream.test.tsx`
**What to do:** Add a failing test that drives the reducer through `start` → `metadata`. Behavior covered: after the metadata dispatch, the chip renders the committed provider+model in place of the ellipsis (and not on first token).
**Acceptance:** Test fails if the chip waits for the first token instead of the metadata frame.
**Verify:** Same test command reports the new test as failing.

#### Task 144 (GREEN): Chip transitions on metadata frame, not on first token
**Files:** `apps/web/components/chat/MessageList.tsx` (`MessageMeta`)
**What to do:** Ensure `MessageMeta` keys the chip swap on the presence of `message.provider` (which the reducer sets at metadata-frame time per Block A); remove any token-counting heuristic if present.
**Acceptance:** Task 143 passes; Tasks 141–142 stay green.
**Verify:** Same test command is clean.

---

### Block I — End-to-end Playwright specs (non-TDD per HLD)

#### Task 145: [non-TDD — Playwright open-pick-send-verify-chip] ProviderPicker happy-path spec
**Files:** `tests/e2e/specs/provider-picker.spec.ts`, `tests/e2e/pages/ChatPage.ts` (helper additions if needed)
**What to do:** Add a spec that signs in as `demo@argus.dev` / `let-me-in-9`, opens the provider picker, selects `mock` / `mock-1`, sends a turn, waits for terminal state, asserts the assistant message's provider chip text matches `mock · mock-1`.
**Acceptance:** Spec passes against the live compose stack with `MOCK_PROVIDER=true`.
**Verify:** `pnpm --filter @argus/e2e test specs/provider-picker.spec.ts`.

#### Task 146: [non-TDD — Playwright refresh persistence] Picker pin survives a hard page refresh
**Files:** `tests/e2e/specs/provider-picker.spec.ts` (additional `test()` block in the same spec file)
**What to do:** Add a second spec block: sign in, pick `mock` / `mock-1`, refresh the page, assert the picker trigger label still reads the pinned `mock · mock-1` on first paint.
**Acceptance:** Spec passes.
**Verify:** `pnpm --filter @argus/e2e test specs/provider-picker.spec.ts`.

#### Task 147: [non-TDD — Playwright keyboard-only flow] Composer focus persistence spec
**Files:** `tests/e2e/specs/composer-focus.spec.ts`
**What to do:** Add a spec that signs in as the demo user, sends five consecutive prompts using only the keyboard (no mouse between turns), asserts the composer textarea is `:focus` before each send and immediately after each turn completes; covers the URL transition from `/chat` to `/chat/<id>` on the first send.
**Acceptance:** Spec passes; no `page.locator.click()` calls on the composer textarea between turns.
**Verify:** `pnpm --filter @argus/e2e test specs/composer-focus.spec.ts`.

#### Task 148: [non-TDD — env-gated selection helper] Conditional-skip primitive for env-gated specs
**Files:** `tests/e2e/support/realProviderGate.ts` (or wherever the repo keeps Playwright support utilities — worker picks the cleanest insertion point)
**What to do:** Add a small helper exporting `skipIfRealProviderAbsent()` that calls `test.skip(...)` with a descriptive message when the `REAL_PROVIDER` env is unset. Used as the first line of any env-gated spec.
**Acceptance:** Helper compiles, is typed, and is exported.
**Verify:** `pnpm --filter @argus/e2e typecheck` (or whatever typecheck command the e2e package exposes).

#### Task 149: [non-TDD — Playwright multi-turn against a real provider, env-gated] "what's my name?" memory spec
**Files:** `tests/e2e/specs/multi-turn-memory.spec.ts`
**What to do:** Add a spec that first calls `skipIfRealProviderAbsent()` (Task 148). When the env is set, sign in as the demo user, pick a specific real-provider model via `ProviderPicker`, send "my name is Priya", wait for the assistant terminal state, send "what is my name?". Behavior covered: the second response contains "Priya".
**Acceptance:** Spec passes locally with the env set against one configured real provider; spec is skipped when env is absent.
**Verify:** `REAL_PROVIDER=openai pnpm --filter @argus/e2e test specs/multi-turn-memory.spec.ts` (or the equivalent for whichever provider the operator has configured).

#### Task 150: [non-TDD — Playwright multi-turn against mock, CI-safe] Mock-provider memory spec
**Files:** `tests/e2e/specs/multi-turn-memory-mock.spec.ts`
**What to do:** Add a CI-safe spec that signs in as the demo user, picks `mock` / `mock-1`, sends a two-turn conversation that depends on the mock's deterministic-by-`(conversationId, turnIndex)` behaviour. Behavior covered: the second response demonstrates the conversation history was forwarded (e.g. by asserting the second response references the first prompt verbatim — exact assertion shape depends on the mock's deterministic output, which the spec author confirms by running once).
**Acceptance:** Spec passes against the live compose stack with `MOCK_PROVIDER=true`.
**Verify:** `pnpm --filter @argus/e2e test specs/multi-turn-memory-mock.spec.ts`.

---

## Quality Gates

- typecheck: `pnpm --filter @argus/web typecheck`
- lint: `pnpm --filter @argus/web lint`
- unit test: `pnpm --filter @argus/web test`
- e2e test: `pnpm e2e` — for Block E/F/G/G2/G3/H/I tasks only

## Dependencies

- `lld-backend-api.md` (sibling) — Block A tasks (1–32) must land in the same PR as the backend's contracts + orchestrator + frame-builder tasks per HLD Sequencing. Blocks B–I may ship independently.
