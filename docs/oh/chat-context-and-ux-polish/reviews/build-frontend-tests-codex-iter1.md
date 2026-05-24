1. **Coverage gaps the LLD acceptance demands but weren't covered**

Block G2+ is materially under-tested. The diff itself says later production code covers “ProviderPicker wiring (LLD Tasks 119-122)”, “Pin + fallback notice threaded from the history hook (LLD Tasks 123-124, 134-135)”, “Optimistic pin state (LLD Tasks 125-130)”, “Inline pin-fallback notice dismissal (LLD Tasks 132-139)”, and “Provisional state (LLD Tasks 141-144)”, but new tests mostly stop at standalone `ProviderPicker`.

Missing tests:
- `MessageComposer` renders `ProviderPicker` when `catalog` is supplied and legacy pills when omitted.
- `MessageComposer` calls `patchConversationPin` / `clearConversationPin` with `conversationId`.
- optimistic pin updates immediately, then rolls back on PATCH failure and shows `pin-error-notice`.
- no-op pin/clear when `conversationId` is null.
- fallback notice renders from `pinFallbackNotice`, dismiss calls `clearPinFallbackNotice`, hides immediately, and does not reappear across remount.
- `MessageStream` threads `providerCatalog`, `pinnedProvider`, `pinnedModel`, `pinFallbackNotice` to composer.
- `ChatSurface` passes catalog/error/ready states correctly into `MessageStream`.
- streaming-chip provisional state: `MessageMeta` should show pending ellipsis before metadata and swap to provider/model after metadata.

2. **Sanitizer test rigor**

The sanitizer tests are decent for basic Markdown URL schemes, but they do not close the XSS surface.

Missing bypass classes:
- encoded schemes: `[x](&#106;avascript:alert(1))`, percent/newline encodings, entity-decoded `href`.
- null bytes/control chars: `java\0script:`, `jav&#x09;ascript:`.
- SVG/MathML raw HTML payloads, even if `rehype-raw` is absent, should be regression-pinned.
- `srcset` and image-like attributes if schema ever permits them.
- CSS vectors: `style`, `className` clobbering, `url(javascript:)`.
- autolinks and bare URLs from GFM, not just explicit `[x](url)`.
- DOM clobbering ids/names if default schema allows `id` or `name`.

Also, `SRC_PROTOCOLS` includes `mailto`, but comments/tests say image src allows only `http/https`. No test catches that mismatch.

3. **Reducer invariant gaps**

Coverage is fragmented. There is no single integration test for the canonical stream: `start → metadata → token → token → end`, asserting:
- content is concatenated in order,
- metadata does not affect sequence handling,
- provider/model survive promotion,
- tokens survive only on complete,
- composer lock releases.

Replay coverage only checks identical metadata returns same state. It does not test replay after tokens or replay with same `seq` but different provider/model. The reducer currently accepts conflicting metadata and mutates provider/model; if the protocol says emitted exactly once/idempotent replay, there should be a test deciding whether conflicting replay is ignored or last-write-wins.

No test verifies provider/model on the completed message and rendered chip after the full mixed sequence except one `MessageStream` case. Reducer should own that invariant directly.

4. **Async/effect test gaps**

Catalog fetch failure is implemented but not meaningfully tested. Need `ChatSurface` test for `fetchProviderCatalog` rejection: notice appears, app still renders, composer picker disabled/empty.

PATCH failure states are untested. The riskiest code is optimistic state plus async rollback in `MessageComposer`; standalone `providers-api` rethrow tests do not cover UI behavior.

Focus hook lacks rapid-switch coverage: A → B → A, switch while streaming, switch while disabled, and unmount before effect/async completion. Current tests are synchronous rerenders only.

The mentioned `act()` warning in `ChatSurface.test` is a red flag. Since `ChatSurface` now fetches catalog on mount, unresolved effect updates can leak across assertions. That can mask real async state bugs: stale catalog success after unmount, error notice timing, or tests asserting before loading/ready settles.

5. **e2e gaps**

The markdown screenshot baseline is not committed, so `toHaveScreenshot()` will fail or require snapshot update. As written, this is not CI-ready.

Real-provider memory is env-gated, which is fine, but the mock spec is not equivalent. It asserts two mock outputs differ, which proves turn index changed only if the mock’s implementation truly derives turn index from forwarded history. It does not prove semantic memory or actual prior message inclusion.

Pin persistence across refresh is actually asserted in `provider-picker.spec.ts`: it sends first, pins, reloads `/chat/:id`, and expects trigger text. Weakness: it does not wait/assert PATCH completion independently before refresh, so it may be timing-sensitive unless UI text only updates after persistence, which it does not.

6. **Edge cases the worker didn't think of**

- Pin selection before first send is intentionally a no-op; no test verifies the UX makes that clear or avoids misleading “pinned” state.
- Stale pinned model absent from catalog falls back to Auto in standalone picker, but no integrated fallback notice test covers the actual resumed conversation path.
- Duplicate provider/model catalog rows or provider/model strings containing spaces/slashes breaking `data-testid`.
- `ProviderPicker` uses a fixed `id="provider-picker-listbox"`; multiple composers/pickers would duplicate ids.
- `useFocusComposer` focuses twice on initial mount because mount and `conversationId` effects both run; harmless now, but untested and can interact badly with disabled initial state.

7. **Test sufficiency score 1-10**

**6/10.** Good breadth for isolated primitives, but the riskiest shipped behavior is integration async UX from Block G2 onward, and that is exactly where coverage is thinnest.
