## 1. Format violations

1. None found.

## 2. Underspecified requirements

1. **Provider/model provenance, Scope**: “after the first real chunk is committed” is ambiguous for failures before first chunk. Engineer would ask: what chip/error state appears if routing succeeds but no assistant chunk is ever produced?

2. **Markdown rendering, Scope**: GFM support is broad. Engineer would ask: are images, blockquotes, autolinks, strikethrough, nested tables/lists, and raw HTML inside Markdown included or excluded?

3. **Unsafe links, Scope**: “Links using the javascript scheme never render” is incomplete. Engineer would ask: what about `data:`, `vbscript:`, malformed URLs, protocol-relative URLs, `mailto:`, relative paths, and hash links?

4. **Same-origin links, Scope**: “same-origin links open in the same tab” needs product behavior for internal app routes. Engineer would ask: should they use normal navigation, SPA routing, or be treated as plain links?

5. **Multi-turn context, Scope**: “Oldest turns drop first” does not define unit of dropping. Engineer would ask: drop whole turns, individual messages, system prompts, failed turns, tool messages, or provider metadata?

6. **Context budget, Scope**: “default context budget for a conversation is 10,000 tokens” does not define what counts. Engineer would ask: include system prompt, prior assistant replies, current user message, hidden routing instructions, notices, or only visible chat messages?

7. **Context meter, Scope**: “updates after every completed turn” leaves streaming behavior unclear. Engineer would ask: should the meter remain stale during streaming, show provisional usage, or hide?

8. **Pinned model cost display, Scope**: “per-million-token prompt and completion cost” lacks currency and source of truth. Engineer would ask: USD? operator-configured? hardcoded catalog? what if pricing changes?

9. **Configured providers, Scope**: “lists every provider whose credentials are configured” is underspecified for partially configured providers. Engineer would ask: what counts as configured if the key exists but is invalid, expired, quota-blocked, or model access is denied?

10. **No credentials empty state, Scope**: “naming the environment variables an operator can set” is too implementation-facing and incomplete. Engineer would ask: exact copy? all provider env vars or only supported providers? should end users see env var names?

11. **Pinned provider failure, Scope**: “surfaces clearly in the conversation” is vague. Engineer would ask: exact user-facing state, retry affordance, whether user message is preserved, and whether the failed turn appears in history.

12. **Unavailable pinned model, Scope**: “shows a one-time inline notice” needs lifecycle rules. Engineer would ask: one time per conversation, per device, per session, or per unavailable model?

## 3. Internal contradictions

1. **Open Questions vs decided items**: Section is titled “Open Questions” but contains decisions: “Default chosen: single shared heuristic,” “10k chosen,” “Server-side persistence chosen,” “Decided: excluded,” and “Decided: fraction with the unit.” These are not open questions.

2. **Markdown link rendering vs HTML inertness is potentially conflicting**: Scope says “Assistant output containing HTML is rendered as inert text,” but also says “External Markdown links… open in a new tab.” If the assistant outputs an HTML anchor tag, it must be inert; if it outputs Markdown link syntax, it is active. This distinction should be explicit.

## 4. Missing edge cases

1. What happens when a user changes the pinned model after a long conversation already exceeds the newly selected model’s smaller context window?

2. What happens when the selected provider/model becomes unavailable while a turn is streaming?

3. What happens when Auto mode chooses a provider/model whose context window is smaller than the current conversation usage?

4. What happens when provider/model metadata is missing from a completed assistant message even though content streamed successfully?

5. What happens when a streamed Markdown response ends with an unclosed fence, list, table, link, or emphasis marker?

6. What happens when Markdown contains very large code blocks, very wide tables, or long unbroken inline code on mobile?

7. What happens when the provider picker has many models across providers? Search, scroll, grouping collapse, or fixed list?

8. What happens when a user opens the picker, then a stream starts from another tab or session?

9. What happens when two devices have the same conversation open and one changes the pinned model?

10. What happens when a pinned provider fails due to auth/quota/rate limit versus transient network failure? Same user-facing error or distinct messages?

11. What happens to focus when send fails validation, network fails before streaming, or the user submits an empty/whitespace message?

12. What happens to the context meter when the server-supplied count is missing on resumed conversation first paint?

## 5. Scope creep risks

1. The provider/model picker with configured-provider discovery, grouped models, pricing, disabled empty state, persistence, unavailable-model notices, and pinned failure semantics is a substantial feature, not just “static label becomes dropdown.”

2. Context accounting plus effective model-window capping may require provider/model catalog work and token-estimation policy that belongs partly in HLD.

3. Full GFM rendering including tables and task lists is broader than the core “Markdown readable” need; tables/task lists could be deferred if delivery risk is high.

4. Cross-device persistence and multi-tab behavior are implied by server-side persistence but not necessary for first-contact UX polish unless explicitly required.

## 6. Length check

1. Longer than ideal for a 1-2 page PRD; readable in around 5 minutes but dense.

2. Cut or move to HLD: “first real chunk is committed,” “effective budget is the smaller of configured default and model’s published context window,” and token-count heuristic details.

3. Tighten Open Questions by moving decided items into Scope or removing the section.

## 7. Quality score

7
