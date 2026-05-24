---
phase: prd
status: APPROVED
slug: chat-context-and-ux-polish
created: 2026-05-24T15:58:25Z
updated: 2026-05-24T18:14:00Z
---

# Chat UX, Multi-Turn Context, and Provider Surface

## Problem

The chat surface now streams from real providers, but five gaps make it feel broken on first contact:

- The per-message provenance chip lies. Every assistant message claims it came from the mock provider, even when a real provider produced it. The truth lives in the database and traces, but the UI contradicts it.
- Assistant responses arrive in Markdown source. Users see literal hashes, asterisks, and dashes instead of headings, bold text, and lists. Anything beyond a one-line reply is unreadable.
- The model has no memory of prior turns. Saying "my name is X" then asking "what is my name?" fails because only the most recent user message reaches the provider. There is also no signal showing how much of the context window remains.
- The input loses focus after sending. Every turn forces the user back to the mouse before they can type the next prompt.
- The provider/model selector is a static label. Users cannot pin a specific model for testing or preference, and cannot see what is configured or what each option costs.

Individually each is small. Together they make a real conversation feel unfinished and untrustworthy.

## Target Users

- **People evaluating Argus end-to-end** running the demo flow (sign in as the seeded demo user, ask multi-turn questions, watch streaming, glance at provenance). They are the primary judges of whether the surface feels honest and usable.
- **Operators comparing provider behavior** who need to pin a specific model for a turn to A/B responses, latencies, or costs across OpenAI, Anthropic, and Gemini.
- **Developers extending the chat surface** who rely on the rendered conversation and provenance chips to debug provider routing without leaving the UI for logs or Jaeger.

## Scope

In scope for this round:

- Per-message provider and model labels reflect what actually streamed, end-to-end, with parity between the chat UI, the persisted record, and the trace span. While a turn is streaming, the chip shows a neutral provisional state (an ellipsis); the real provider and model values only render after the first real chunk is committed, so the chip never displays a wrong value, even briefly. If the request fails before any chunk arrives, the chip transitions from the provisional ellipsis directly to a failure state without ever displaying a provider or model name.
- Assistant Markdown renders as formatted text: headings, bold, italics, ordered and unordered lists, inline code, fenced code blocks, GFM tables and task lists. Streaming-safe (partial Markdown does not crash). User messages stay plain text.
- Assistant output containing raw HTML is rendered as inert text — no HTML interpretation, no script execution, no navigation hijack. Markdown link syntax such as `[label](url)` is still parsed and renders as an active link subject to the scheme and origin rules below; the inertness rule applies only to raw HTML embedded in assistant output, not to links the assistant expresses in Markdown syntax.
- External Markdown links (http/https to a different origin) open in a new tab with appropriate browser-safety attributes; same-origin links open in the same tab. Links using the javascript scheme never render.
- Multi-turn conversations send prior turns to the provider so the model can refer back to earlier context. Oldest turns drop first when budget is exceeded; the user's latest message is never dropped.
- The default context budget for a conversation is 10,000 tokens. When a conversation is pinned to a specific model, the effective budget is the smaller of the configured default and that model's published context window.
- A visible context-usage indicator on the chat surface shows how many tokens the current conversation occupies versus the effective budget. The indicator is server-supplied (not a client guess) and updates after every completed turn. It also renders correctly when resuming an existing conversation, before any new turn.
- The composer input keeps keyboard focus across send, across initial load of a new chat, and across the URL transition from a fresh chat to a saved one. Focus is not stolen mid-stream, and clicking elsewhere intentionally releases it.
- The static provider pill becomes a working dropdown: lists every provider whose credentials are configured, grouped by provider, with each model's per-million-token prompt and completion cost shown inline. When cost is unknown for a model, the picker shows "—" in its place. "Auto" remains the default. Selecting a specific model pins the rest of that conversation to it.
- When no provider credentials are configured at all, the picker pill stays visible but the dropdown does not open; instead it shows a single disabled label noting that no providers are configured and naming the environment variables an operator can set. Auto remains the default selection.
- The picker is disabled while a turn is streaming; the user cannot change the pin until the stream completes or fails.
- A user pinned to a specific model can switch back to Auto from the same picker; from the next turn onward the conversation uses failover again. Past turns retain their own per-message provenance chips.
- When a user has pinned a specific model and that provider fails, the failure surfaces clearly in the conversation; the system does not silently fall back to another provider.
- The user's pinned choice persists server-side with the conversation, so reopening on another device or after a refresh restores it.
- When a resumed conversation was pinned to a model that is no longer in the configured provider list, the conversation silently falls back to Auto for the next turn and shows a one-time inline notice naming the previously-pinned model. Past turns retain their own provenance chips.

## Non-Goals

- No syntax highlighting inside fenced code blocks this round. Plain monospace rendering is enough.
- No CommonMark-strict fallback; GFM is the rendering target.
- No differentiation in the picker between cached-token, reasoning-token, or image-token pricing variants. A single prompt/completion pair per model is shown.
- No sharing, editing, or deleting of pinned model selections from a separate settings surface. Pinning happens only from the in-chat dropdown.
- No per-organization or admin-level provider configuration UI. The dropdown reflects what the server already has credentials for; configuring credentials stays an operator concern outside the product surface.
- No automatic failover when the user has explicitly pinned a provider. Auto mode keeps its existing failover behavior.
- No retroactive recomputation of provenance chips on conversations created before this change ships. New turns show correct labels; old turns are left as-is.
- No syntax-highlighted streaming Markdown preview in user input. User input stays plain.
- No client-side token estimator as a fallback when the server-supplied count is missing. If the server does not send it, the meter shows nothing for that turn rather than guessing.
- Carried-over operational issues from the prior round (Anthropic 4.x pricing, Workers integration test baseline, otel-collector healthcheck, dev-mode process-tree orphan on Ctrl-C) are tracked separately and out of scope here.

## Success Criteria

Observable, demoable outcomes:

- A new user can send "plan me a trip to Bali" against a real provider and read the response as formatted text with headings, bullets, and bold — not raw Markdown — within the first turn.
- The provider and model shown on each assistant message bubble matches the value stored against that message and the value recorded in the trace for that turn. A reviewer spot-checking three random messages across providers finds zero mismatches. During an in-flight stream, the chip on the streaming bubble shows a neutral provisional state and never displays a wrong provider name.
- A new user sends "my name is Priya," waits for the response, then sends "what is my name?" and the assistant answers "Priya" without further prompting. This works against each configured real provider.
- A new user sends five consecutive prompts using only the keyboard, never touching the mouse between turns. The composer is focused on initial page load, stays focused after each send, and is focused again when the URL transitions from the new-chat route to the saved-conversation route.
- The chat surface shows a context-usage indicator that updates after each completed turn and is also present on the first paint of a resumed conversation. The displayed budget reflects the effective budget (10k by default, capped by the pinned model's window when smaller).
- A user opens the model picker, sees every provider with configured credentials (and only those), sees per-million-token costs next to each model (or "—" when unknown), picks a specific model, and the next assistant response demonstrably comes from that model (verified by the chip from the first success criterion).
- A user with no configured provider credentials sees the picker pill in a disabled empty state naming the relevant environment variables, with Auto as the selection. The dropdown does not open.
- Reopening a conversation where a specific model was pinned restores that pin; subsequent turns continue against the pinned model until the user changes it.
- Reopening a conversation whose pinned model is no longer configured shows a one-time inline notice naming the previously-pinned model, falls back to Auto, and the next turn streams from an available provider.
- When a pinned provider errors, the user sees a clear in-conversation error attributing the failure to that provider, with no silent fallback.
- Assistant output that attempts to inject executable HTML or unsafe links is rendered inertly; no scripts run and no navigation is hijacked.

## Decisions

These items were resolved during PRD review and are recorded for audit. The architect may override any of them at HLD if implementation reveals a better path.

- **Token-count exactness for the context meter.** A single shared heuristic is simpler; per-provider tokenizers are more precise but add drift. Default chosen: single shared heuristic; override at HLD if needed.
- **Default context budget value.** 10k chosen; override at HLD if a different value is appropriate.
- **Persistence of the pinned model choice.** Server-side persistence chosen; override at HLD if cross-device continuity is not required.
- **Whether failed or partially-streamed assistant turns should count toward future context.** Decided: excluded — only fully-completed turns enter history.
- **Whether the context meter shows a percentage, a fraction, or both.** Decided: fraction with the unit, e.g. "8.2k / 10k tokens."

## Constraints

- The five items share the chat surface and three of them touch the same wire-format contract; they must be planned together so the contract is revised once. PRs ship independently so a stall on one does not block the others.
