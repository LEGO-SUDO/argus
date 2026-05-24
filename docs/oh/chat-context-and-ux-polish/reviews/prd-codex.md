## 1. Format Violations

1. None found. The PRD stays product-level and avoids code, API specs, file paths, function names, FR/NFR numbering, test-plan formatting, and concrete architecture choices.

## 2. Underspecified Requirements

1. **Provider/model labels — Scope**: “reflect what actually streamed” is clear, but not what to show during streaming before final persistence. Engineer would ask: should the chip appear immediately, update mid-stream, or only after completion?

2. **Markdown rendering — Scope**: “HTML embedded in assistant output is sanitized so it cannot run scripts or hijack navigation” does not define whether HTML should render as sanitized HTML or display as inert text. Success criteria says “renders as inert text,” which should be made explicit in Scope.

3. **Multi-turn context — Scope**: “Oldest turns drop first when budget is exceeded” does not define whether system/developer prompts, pinned model metadata, failed turns, or current assistant partials count. Some is open-questioned, but not all.

4. **Context meter — Scope**: “configured budget” is not defined per provider, per model, per app default, or per conversation. Engineer would ask what happens when pinned models have different context windows.

5. **Context meter — Scope**: “updates after every completed turn” does not say what it displays while a turn is streaming or after a failed turn.

6. **Focus behavior — Scope**: “clicking elsewhere intentionally releases it” needs boundaries. Engineer would ask whether selecting text, opening the model picker, clicking a message link, or interacting with copy buttons should restore focus afterward.

7. **Model picker — Scope**: “lists every provider whose credentials are configured” does not define the empty state when no real credentials are configured.

8. **Model picker — Scope**: “each model’s per-million-token prompt and completion cost shown inline” does not define unknown, variable, cached-token, reasoning-token, image, or free-tier pricing cases.

9. **Pinned model — Scope**: “Selecting a specific model pins the rest of that conversation to it” does not define whether changing back to Auto is allowed, though Auto remains default. Engineer would ask how unpinning works.

10. **Pinned provider failure — Scope**: “failure surfaces clearly in the conversation” does not define retry behavior or whether the failed user turn remains pending, failed, or can be resent.

## 3. Internal Contradictions

1. **Sanitized HTML behavior**
   - Scope says: “HTML embedded in assistant output is sanitized so it cannot run scripts or hijack navigation.”
   - Success Criteria says: “Assistant output containing a script tag or a javascript-scheme link renders as inert text.”
   These imply different behavior: sanitized rendered HTML vs literal inert text.

2. **Pinned model persistence certainty**
   - Scope says: “The user's pinned choice persists with the conversation”
   - Open Questions says: “Persistence of the pinned model choice... Default proposal: server-side”
   This is presented as decided in Scope but still open later.

3. **Context budget decision certainty**
   - Scope says: “configured budget”
   - Open Questions says: “Default context budget value... Confirm this is the right ceiling”
   The feature depends on a budget, but the PRD leaves the budget undecided.

## 4. Missing Edge Cases

1. What happens when a conversation is resumed and the provider/model used for an old pinned selection is no longer configured?

2. What happens when a pinned model is removed, renamed, deprecated, or hidden from the configured provider list?

3. What happens when the user changes the model picker during an active stream?

4. What happens when Auto mode selects a provider/model: should the conversation become pinned to that model, or remain Auto?

5. What happens when a user pins a model after prior turns were created under Auto? Does the full previous context still get sent to the newly pinned provider?

6. What happens when the context budget is exceeded by the latest user message alone?

7. What happens when dropping oldest turns would remove necessary context but preserve a later assistant response that refers to it?

8. What happens when Markdown is incomplete during streaming, especially open code fences, tables, nested lists, or unterminated emphasis?

9. What happens when assistant Markdown includes links? Should links open in a new tab, be rel-safe, or be disabled during streaming?

10. What happens when provider credentials exist but are invalid, expired, quota-limited, or disabled?

11. What happens when cost metadata is unavailable or stale for a configured model?

12. What happens for old conversations with old provenance chips plus new turns with corrected chips? The non-goal says no retroactive recomputation, but the mixed display state needs product treatment.

## 5. Scope Creep Risks

1. GFM tables and task lists may be more than needed for first-contact readability. Basic Markdown could be a smaller increment.

2. Full provider/model picker with pricing across OpenAI, Anthropic, and Gemini is a larger product surface than “static label becomes usable,” especially if pricing accuracy and model catalog freshness matter.

3. Server-supplied context usage indicator adds contract and persistence complexity beyond fixing multi-turn memory.

4. Cross-device persistence of pinned model choice expands the model picker from local chat preference to durable conversation state.

5. Sanitization/security behavior is necessary if rendering Markdown/HTML, but “script tag or javascript-scheme link” injection testing belongs more in LLD acceptance detail than PRD success criteria.

## 6. Length Check

1. Readable in under 5 minutes, but dense. It is closer to 2-3 pages than 1-2.

2. Cut or move to HLD/LLD: detailed sequencing constraints, specific excluded infra issues, tokenizer implementation discussion, and injection-test phrasing.

3. Keep in PRD: problem, users, scope bullets, non-goals that define product boundaries, and demoable success criteria.

## 7. Quality Score

7
