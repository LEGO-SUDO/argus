## 0. Format Violations

1. HLD length over 120 lines.
   Quote: entire HLD is materially over the 120-line limit.
   Move to: split implementation inventory, exhaustive tests, and regression details into LLD.

2. API endpoint URLs/spec detail included.
   Quote: `PATCH /conversations/:id`
   Move to: LLD.

3. API endpoint URLs/spec detail included.
   Quote: `GET /providers`
   Move to: LLD.

4. Wire payload shapes are too detailed for HLD.
   Quote: `context` frame `{ messageId, tokensUsed, tokensBudget }`
   Move to: LLD/contracts.

5. Configuration/env names included.
   Quote: `MOCK_PROVIDER=true`
   Move to: LLD or code.

6. Magic strings/error codes included.
   Quote: `ProviderError('pinned_provider_failed', …)`
   Move to: LLD/contracts.

7. Magic strings/OTel attributes included.
   Quote: `llm.context_tokens_used`, `llm.context_tokens_budget`, `llm.error_code`, `llm.pinned=true`
   Move to: LLD/observability spec.

8. File-change inventory is too exhaustive for HLD.
   Quote: `## File-Change Inventory`
   Move to: LLD/task breakdown.

9. Test section is too granular.
   Quote: `provider-resolved ... idempotent on replay`, `<script> becomes inert text`, `javascript: href stripped`
   Move to: LLD/test plan.

## 1. Data Flow Correctness

1. `provider-resolved` after first token is underspecified.
   If the orchestrator observes the first token and emits `provider-resolved` “immediately after,” the client may receive token content before provider metadata. That may be acceptable, but the HLD claims a clean chip transition without defining ordering guarantees between those frames.

2. Context metering after `end` has an ordering risk.
   Quote: `After each terminal end with status complete, the gateway emits a context frame`
   If the client treats `end` as terminal and finalizes the stream before later frames, the `context` frame may be ignored. Safer ordering is `context` before `end`, or define `end` as not closing the logical message lifecycle.

3. Context count source is ambiguous.
   Quote: `summing messages via the shared heuristic`
   It is unclear whether the just-completed assistant message is persisted before `ContextMeterService` reads. If persistence and frame emission are not transactional/ordered, the meter can lag by one turn.

4. Observability contradicts ownership boundaries.
   Quote: `Set in packages/sdk/src/otel.ts at span-start` using values from `ContextMeterService`
   The SDK span cannot know API-computed conversation context unless the API passes those values into the SDK request. That data flow is missing.

5. Pin validation is incomplete.
   Quote: `Picker selection writes via PATCH`
   The HLD does not say whether PATCH validates provider/model against configured adapters before persisting. If invalid pins can be saved, every later send becomes a runtime failure.

6. Multi-turn context loading needs a clear cut line.
   Quote: `startTurn loads prior turns`
   The HLD notes not to include an in-flight assistant row, but does not define whether the new user message is persisted before or after history assembly. That affects whether the SDK request includes the current user turn once or twice.

7. Provider list source of truth is split.
   Quote: `ProvidersController returns configured providers + models + cost`; SDK also has `listConfiguredProviders()`
   The HLD says SDK exposes the list, but the API owns env/config. If SDK config and API config are not the same runtime source, picker options can diverge from actual gateway behavior.

## 2. One-Way Doors Not Flagged

1. REST response shape change is not flagged as one-way.
   Quote: `The REST messages-list response gains the same fields`
   This is a client-visible contract change and should be grouped with contract migration/rollback.

2. Database semantics beyond additive columns are not flagged.
   Quote: `fallback-to-Auto when the saved pin is no longer configured`
   This is persistent behavior, not just schema. It affects user-visible state recovery and should be called out.

3. Markdown renderer dependency and sanitization policy are not flagged.
   Quote: `Markdown via react-markdown + remark-gfm + rehype-sanitize`
   Switching message rendering changes stored-content interpretation and snapshot/user-visible behavior. It is reversible technically, but costly after users rely on Markdown rendering.

4. Provider picker public surface is not flagged.
   Quote: `New public listConfiguredProviders() returns the picker's source-of-truth`
   Adding public SDK API is a compatibility commitment. Mark as one-way or explicitly internal-only.

## 3. Missed Failure Modes

1. WS reconnect after `start` but before `provider-resolved`.
   Client may hydrate a streaming bubble with no provider forever unless replay/resume semantics include provider resolution state.

2. WS reconnect after `end` but before `context`.
   Meter can remain stale unless REST reload or replay guarantees include final context.

3. PATCH pin succeeds while provider config changes before send.
   The HLD mentions fallback-to-Auto, but not whether the user is notified or whether the next turn silently routes differently than the visible picker state.

4. `/providers` unavailable or slow.
   Composer behavior is unspecified: cached provider list, Auto-only fallback, disabled picker, or send still allowed.

5. Malformed `provider-resolved` or `context` frame.
   Zod rejection is tested, but runtime behavior is not described: ignore frame, fail stream, log, or force reload.

6. Context-window catalog missing a model.
   Unknown default is mentioned in tests, but architecture risk remains: a too-large default can overrun small models; a too-small default can unnecessarily degrade quality.

7. Cost catalog/provider catalog drift.
   Picker joins configured providers with cost/context data. Unknown cost falls back to null, but unknown context behavior is not described for UI or budget.

8. Markdown sanitizer misconfiguration.
   HLD assumes `javascript:` is stripped, but rehype-sanitize needs explicit schema care for protocols and link attributes.

9. Provider resolves after first chunk but first chunk is empty/tool/meta.
   If adapters can emit non-token chunks, “first token chunk” needs a precise definition.

10. Canceled turns.
   Quote: `failed/canceled turns produce no context frame`
   If the user sends another message immediately after cancel, context budget may or may not include partial assistant output depending on persistence behavior.

## 4. Simpler Alternatives

1. `provider-resolved` frame:
   Simpler alternative: emit `start` early with `provider/model: null`, then emit a single `metadata` or `message-updated` frame when resolved. This avoids a provider-specific frame type and leaves room for future metadata.

2. Context frame after completion:
   Simpler alternative: include final context fields on the terminal `end` frame for completed turns. That avoids post-terminal frame ordering issues.

3. Pinned provider columns:
   Current choice is reasonable. A simpler API path would be to update pin only through conversation update semantics already present, avoiding a new provider-specific controller action if one exists.

4. SDK `providerOverride`:
   Reasonable. Simpler implementation detail: model this as `routingMode: auto | pinned` plus provider/model internally, but keep public API narrow.

5. Context-window catalog:
   Simpler alternative: extend the existing pricebook/model catalog rather than adding a parallel table keyed the same way. Parallel catalogs increase drift risk.

6. Providers controller:
   Simpler alternative: expose one API-computed model catalog from the API using SDK helpers internally, without making `listConfiguredProviders()` part of the public SDK surface.

7. Markdown sanitization:
   Reasonable. Simpler alternative: render Markdown only for assistant messages through a single `MessageContent` boundary and avoid a separate `sanitize-markdown.ts` unless tests prove it needs extraction.

8. Focus hook:
   Simpler alternative: keep focus restoration local to `MessageComposer` unless multiple components need the same behavior.

## 5. Quality Score

1. 6/10.

2. The core architecture is plausible, especially pin ownership and router override behavior. It is not ready for LLD decomposition because the HLD is too long, contains LLD-level contract/test/file details, and has unresolved ordering issues around `provider-resolved`, `context`, persistence, and span attribute data flow.
