1. **LLD / PRD Violations**

- `ProviderPicker` cannot pin before first send because `conversationId` is null and `handlePin` returns early. The UI still optimistically appears selectable only if `onPin` runs, but `MessageComposer` suppresses it. This contradicts the picker happy path in the added e2e spec and likely the LLD intent if model choice should affect the first turn.
- `ContextMeter` uses the most recent completed assistant message, which matches “server-supplied meter only,” but it will keep showing stale usage after a later failed/canceled turn. That may be intended per tests, but check the LLD wording: if the meter is meant to represent the active latest turn, this is wrong.
- `MessageMeta` renders the pending provider ellipsis with `aria-hidden="true"`. Visually OK, but screen readers only hear “assistant” with no pending state.
- User messages stay plain and assistant Markdown avoids `rehype-raw`; that matches the locked decisions.

2. **Security**

- Main concern: `sanitize-markdown.ts` comments claim mixed-case dangerous schemes fail because matching is case-sensitive. That is likely not the right security model to rely on. URL scheme handling in unified/hast utilities may normalize or parse differently across versions. Tests cover mixed-case, but the explanatory assumption is brittle.
- Missing tests for encoded/HTML-entity-obfuscated schemes such as `jav&#x61;script:`, percent-encoded colon/scheme tricks, and leading control characters beyond tab/newline. The LLD explicitly mentions encoded; this diff does not prove that.
- `SRC_PROTOCOLS` allows `mailto` for image `src`, which contradicts the stated allowed image test policy and is nonsensical for images. It probably won’t execute, but it is contract drift from “image src follows same rules” if backend/security expected only `http/https`.
- Raw HTML is inert because `rehype-raw` is absent. Good.
- Custom anchor renderer spreads `...rest` before fixed `target`/`rel`, so sanitizer-produced props cannot override those. Good.

3. **React Correctness**

- `ProviderPicker` uses a hard-coded `listboxId = 'provider-picker-listbox'`. Multiple chat surfaces or test renders create duplicate IDs. Use `useId`.
- `ProviderPicker` mutates `optionRefs.current = []` during render. That is a render-time mutation. Usually works, but it is not idiomatic React 19 and can behave poorly under concurrent rendering. Reset in an effect or use callback refs keyed by stable option IDs.
- `MessageComposer` optimistic PATCH handlers have a race: two rapid pin changes can resolve/reject out of order and rollback to stale `previous`. Add request sequencing or disable while saving.
- `useFocusComposer` intentionally suppresses exhaustive deps and does not include `ref` in mount/conversation effects. Stable `useRef` is fine, but the hook API accepts any ref object, so this is technically stale if a caller swaps refs.
- Catalog fetch cleanup uses a boolean cancel guard. Fine for setState, but it does not abort the underlying request.

4. **Contract-Divergence Risk**

- `WsMetadataFrame.providerMeta.provider/model`: check exact nesting. If backend emits `{ provider, model }` at top level or `metadata: { provider, model }`, reducer silently ignores provider/model and chip stays ellipsis.
- `WsMetadataFrame.seq`: reducer intentionally ignores it. If backend expects metadata replay/order to be sequence-gated, frontend behavior diverges.
- `WsEndFrame.tokensUsed/tokensBudget`: local shape uses top-level optional numbers. Check whether backend uses `usage.tokensUsed`, `usage.totalTokens`, `contextWindow`, or nullable fields. This is a high merge-risk spot.
- `MessageDtoExt.tokensUsed/tokensBudget`: same top-level optional-number assumption. If REST returns `null`, mapper drops it as `undefined`; fine for UI hiding, but not 1:1.
- `MessageListResponseExt.pinFallbackNotice.previousProvider/previousModel`: check names against backend. `previousPinnedProvider`, `provider`, or `model` would break notice rendering.
- `ProviderCatalogEntry`: local fields `promptPerMillion`, `completionPerMillion`, `contextWindow` must match exactly. Many APIs would choose `inputCostPerMillion`, `outputCostPerMillion`, or `contextWindowTokens`.
- `PATCH /api/conversations/:id` body uses `{ pinnedProvider, pinnedModel }` and clear uses both fields `null`. Confirm backend does not expect a nested `pin` object or DELETE/nullable whole pin.

5. **Accessibility**

- Combobox pattern is incomplete: focus moves into options instead of keeping focus on the combobox with `aria-activedescendant`. This can still be usable, but it is closer to button + listbox than ARIA 1.2 combobox.
- Trigger has `aria-controls` even when listbox is unmounted; acceptable but less clean.
- No `aria-activedescendant` despite the review criteria explicitly calling it out.
- `aria-disabled` on a button does not actually disable it. Click handler guards opening, but keyboard/click semantics still expose it as focusable. If disabled behavior is desired, use `disabled` or justify focusability.
- `ContextMeter` has a useful `aria-label`. Good.
- Focus composer may steal focus on initial mount/conversation switch even if user is interacting elsewhere during navigation. That is intended, but aggressive.

6. **State / Ownership**

- Prop threading from `ChatSurface -> MessageStream -> MessageComposer` is still tolerable for this scope, but pin/catalog state is now composer-owned while catalog/history are surface-owned. If more chat controls are added, a small chat config context would be cleaner.
- Catalog fetch races first render: composer receives `{ providers: [] }` while loading, so the picker initially renders “No providers configured” instead of a loading/disabled-loading state. That can flash incorrect env-var guidance.
- Pin optimistic state never updates the history cache’s `pinnedProvider/pinnedModel`, so a remount before refetch may show stale pin.
- First-turn pinning is not supported because no conversation exists. That is a real product gap if users expect model selection before sending.

7. **Quality Score**

7/10. The implementation is broad and mostly aligned, but the first-turn pin gap, incomplete combobox semantics, sanitizer edge coverage, duplicate IDs, and contract-shape risks need tightening before final integration.
