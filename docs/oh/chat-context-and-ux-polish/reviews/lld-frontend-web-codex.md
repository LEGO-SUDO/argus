## 0. Format Violations

Hard rejection: the LLD contains many detailed test assertions. A plan can say what behavior is covered, but the test file should own exact assertion mechanics.

> “asserts the reducer writes both fields onto `state.streaming` without mutating message content or `lastAppliedSeq`”

Keep the behavior target, but remove implementation-level assertion detail.

> “asserts `state.streaming.provider` and `state.streaming.model` are both `undefined` … with `content: ''`, `status: 'streaming'`, and the right `id`”

Too much exact assertion detail. Keep: “start creates a provisional streaming bubble without provider/model.”

> “asserts the second dispatch returns the SAME state reference”

This is acceptable only if same-reference idempotency is an explicit reducer contract. It appears to be, but it should be framed as acceptance behavior, not test mechanics.

> “asserts the rendered HTML has the link's `href` either stripped or rewritten to a safe placeholder”

This specifies HTML-level assertion shape. Keep the security behavior; leave DOM assertion strategy to the test.

> “asserting the resulting anchor has both `rel="noopener noreferrer"` and `target="_blank"` attributes”

This is borderline acceptable because it is the actual observable requirement, but repeated “asserting exact DOM attributes” throughout the LLD makes the plan read like test pseudocode.

> “assert each renders as the expected semantic element (e.g. `h1`, `strong`, `em`, `ul`/`ol`/`li`, `code`, `pre > code`, `table`, list-item with checkbox).”

Too detailed for the plan. Keep the construct inventory and expected semantic rendering, not selector-level details.

Tasks likely over the bite-sized constraint:

> “Task 50: [non-TDD — Playwright screenshot diff] Markdown rendering fidelity spec”

This is not a 5-minute task. It includes auth, seeded mock behavior, waiting for streaming terminal state, screenshots, and snapshot commit. Split into mock-provider fixture behavior, page-object additions, spec, snapshot regen.

> “Task 51: [non-TDD — snapshot regen housekeeping] Update affected existing Playwright snapshots and `MessageList` jest fixtures”

Open-ended snapshot search/regeneration is not bite-sized. Split by known affected specs/fixtures after inventory.

> “Task 71: [non-TDD — visual placement] Embed `ProviderPicker` in `MessageComposer`”

This combines data fetching, prop threading, PATCH mutation, persistence, refresh behavior, and visual replacement. Split into catalog fetch state, prop threading, picker mount, set mutation, clear mutation, persistence hydration.

> “Task 73: [non-TDD — inline notice rendering] Surface the "previously-pinned model unavailable" notice in `MessageComposer`”

This combines hook state, prop threading, UI, dismissal, and cache mutation. Split.

> “Task 77: [non-TDD — Playwright multi-turn against a real provider, env-gated]”

Not bite-sized and depends on external paid provider configuration. Split into env-gated selection helper and the memory spec.

## 1. Tasks Too Vague To Execute

> “metadata frame … new generic metadata frame (type discriminant `metadata`, with `provider` and `model` populated…)”

The exact contract shape is not given. Does it include `seq`? `conversationId`? Are provider/model nullable? The web reducer imports `WsFrameOutbound`; the current contract has no metadata frame, so the builder needs the sibling backend contract merged or a precise agreed DTO shape.

> “expanded `end` shape”

The exact field names and nullability for `tokensUsed` / `tokensBudget` are not defined. Are they optional, nullable, integers, or present only on `complete`?

> “clear it from the cache after the next user-acknowledged turn”

Ambiguous. Is “user-acknowledged” dismissing the notice, sending a new message, receiving a completed assistant turn, or any composer submit? The helper name and call site are also unspecified.

> “Restrict the sanitize URL scheme allow-list to exactly the HLD-approved set”

The HLD-approved set is not fully included in this LLD except indirectly in Task 19. Repeat the canonical allowed/disallowed scheme list in Task 18.

> “catalog path agreed with the backend LLD”

The actual endpoint path is absent. Builder needs the literal route, for example `/api/providers` or `/api/providers/catalog`.

> “conversation's PATCH path … backend LLD's PATCH contract”

The literal PATCH path and body shape are absent. Builder should not have to infer from another document.

> “cost values formatted per PRD”

The PRD format is not quoted. Give exact examples, including currency, decimals, and prompt/completion separator.

> “empty-state … label naming the relevant environment variables”

The exact env var names are not present. This is likely to drift.

> “selects a specific mock-provider model”

The specific provider/model identifiers are not named. E2E tests need stable values.

## 2. Missing Acceptance Criteria

Task 14 acceptance only says the failing test passes, but the task also requires cache persistence and one-time clearing. Add observable acceptance for:

- cached ready state preserves `pinFallbackNotice`
- exported clear helper removes it for that conversation
- clearing does not wipe messages or `omittedCount`

Task 36 says:

> “surface backend validation errors (4xx) by rethrowing `ApiError` from `authFetch` unchanged.”

That belongs to Task 38, but no acceptance/test verifies unchanged rethrow. Add a RED/GREEN pair or acceptance requiring same error instance.

Task 56 acceptance is manual only:

> “Component appears on the chat page after a turn completes…”

There is no observable criterion for selecting “last completed assistant message” when there are failed/canceled messages after it. Add component or integration test coverage.

Task 71 lacks acceptance for loading/error states when catalog fetch fails or PATCH fails. A builder will likely ignore those paths.

Task 74 acceptance says:

> “until the first real token lands, then the provider chip appears”

But provider appears on metadata frame, not first token. The acceptance contradicts Tasks 1–6. Change to “until the metadata frame arrives.”

## 3. Test Gaps

Reducer gaps:

- No test that metadata for a mismatched `messageId` is ignored.
- No test that metadata for an already terminal message is ignored.
- No test that a completed promoted message preserves provider/model learned from metadata.
- No test that metadata replay does not change `lastAppliedSeq`.
- No test for metadata arriving before `start`.

History gaps:

- `pinFallbackNotice` cache behavior is not tested, despite being required.
- Cache-clear helper behavior is not tested.
- No test for absence of `pinFallbackNotice` leaving the ready state clean.

Sanitizer gaps:

- No test for uppercase/mixed-case dangerous schemes such as `JaVaScRiPt:`.
- No test for whitespace/control-character obfuscation in URLs.
- No test for raw HTML in the sanitizer module itself; only `MessageContent` covers raw `<script>` / `<img>`.
- No test for image URL handling, even though Markdown/GFM commonly emits images. The policy should explicitly allow or strip images.

Provider API gaps:

- No test that PATCH helpers serialize body through `authFetch`’s `body` option rather than pre-stringifying incorrectly.
- No error-path test for `ApiError` pass-through.

ProviderPicker gaps:

- No keyboard accessibility tests for opening, navigating, selecting, Escape close, or focus return.
- No test for current pinned provider/model label.
- No test for pinned model missing from catalog.

Markdown integration gaps:

- Task 48 only wires assistant terminal rows. There is no explicit test that user messages remain inert/plain.
- No test that copy action still copies original Markdown source after rendered Markdown is introduced.

E2E gaps:

- ProviderPicker happy path does not verify pin persistence across refresh; Task 71 manual does, but no automated coverage.
- Memory spec is env-gated, so the core “multi-turn context” requirement has no CI-safe mock-provider equivalent.

## 4. File-Path Errors

Most paths exist and match repo conventions.

Issues:

> “`pnpm test:e2e`”

The root script is `e2e`, not `test:e2e`. Use:

`pnpm e2e`

or:

`pnpm --filter @argus/e2e test`

This affects Tasks 51, 75, 76, 77 and the Quality Gates.

> “`pnpm --filter @argus/e2e test markdown-rendering.spec.ts`”

This may work through Playwright argument forwarding, but the repo’s package script is just `playwright test`. Safer verify command:

`pnpm --filter @argus/e2e test specs/markdown-rendering.spec.ts`

> “`tests/e2e/specs/markdown-rendering.spec.ts-snapshots/`”

Playwright snapshot directory naming can include project/platform suffixes depending on `toHaveScreenshot` usage. Don’t hard-code unless the repo already uses that convention. Currently there are no existing snapshot dirs in the listed e2e files.

## 5. Hand-Off Risk

The largest risk is cross-PR coupling. Block A says it must land atomically with contracts/API, but the web tasks import current `@argus/contracts` types. If the builder starts web-only, TypeScript will fail before the RED tests are meaningful.

The sanitizer design is under-specified. `rehype-sanitize` schema alone does not add `target`/`rel`; URL protocol filtering is subtle, especially for protocol-relative URLs, relative URLs, encoded values, and mixed-case schemes.

`react-markdown` raw HTML behavior is easy to misunderstand. By default, raw HTML is escaped unless `rehype-raw` is used. The task says “sanitize strips raw HTML,” but the actual protection may come from not enabling raw HTML parsing. The LLD should explicitly say not to add `rehype-raw`.

Task 44 suggests:

> “a defensive error boundary or try/catch around the rendered tree”

Try/catch around JSX creation will not catch render-time errors in React. If an error boundary is required, say so explicitly. Otherwise rely on `react-markdown` resilience and test partial input.

ProviderPicker is likely to be implemented as a custom dropdown. The LLD does not specify ARIA role pattern, focus management, outside-click close, Escape behavior, or whether a local UI primitive exists. That is a UX/accessibility hand-off risk.

ContextMeter placement is wrong or at least underspecified relative to current ownership. `MessageStream` owns reducer state, so mounting in `ChatSurface` cannot source `state.messages` without lifting state. The task says “MessageStream.tsx (or ChatSurface.tsx, worker decides),” but those choices have different coupling costs.

Task 71 says the composer fetches catalog via `providers-api`. Current `MessageComposer` is presentational. Fetching inside it would mix IO into the composer. The LLD should decide whether `ChatSurface` owns data fetching and passes catalog down.

Task 47 says:

> “latest stable in their current major”

That is unstable and requires network/version judgment. Pin exact acceptable major ranges or instruct the builder to use the latest compatible versions available via `pnpm add`.

## 6. Quality Score

5/10.

The plan has strong coverage intent and mostly correct repo paths, but it is too large, too cross-document-dependent, and over-specifies test assertions while under-specifying API contracts, accessibility behavior, sanitizer policy, and integration ownership. I would revise before handing to a builder.
