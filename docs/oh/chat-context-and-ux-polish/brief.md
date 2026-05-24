---
phase: brief
status: APPROVED
slug: chat-context-and-ux-polish
created: 2026-05-24T15:57:29Z
updated: 2026-05-24T15:57:29Z
---

# Chat UX, Multi-Turn Context, and Provider Surface — Brief

**Status:** Reported 2026-05-24, post-merge of PR #4 (real provider streaming).
**Reporter:** User, during hands-on end-to-end testing of the merged `feat/real-providers-and-dev-workflow` branch.
**Repo state at report:** `main` @ `b181118` (squash-merged PR #4).
**Demo creds for repro:** `demo@argus.dev` / `let-me-in-9` at http://localhost:3000.

## Context

PR #4 landed real OpenAI / Anthropic / Gemini streaming, OTel emission, and a hybrid dev workflow. With keys in `.env` and `MOCK_PROVIDER=false`, real providers now stream — but five UX/correctness gaps surface immediately on a real conversation. Two are confirmed regressions (B1, B2). One is a missing-feature combo with high demo impact (B3a + B3b). Two are smaller UX polish (B4, B5).

The bundle is well-scoped: all five touch the chat surface, three touch the WS frame schemas in `@argus/contracts`, and B3 needs both api + sdk + web changes. They should be **planned together** to avoid frame-schema thrash, but can ship **independently**.

---

## B1 — WS `start` frame hardcodes `mock / mock-1` for real-provider responses

**Severity:** Medium (cosmetic but UI lies about provenance)
**Domain:** apps/api (gateway) + (possibly) `@argus/contracts` (new frame type)
**Status:** Known issue carried over from the HANDOFF; deferred from PR #4.

### Evidence
Screenshot shows assistant chip `● mock /mock-1` next to a multi-section Markdown Bali itinerary that the mock vocabulary cannot produce. Truth-of-record (the `inferences` row + the Jaeger `llm.chat` span attributes) correctly shows the real provider; only the per-message UI chip lies.

### Repro
1. `MOCK_PROVIDER=false`, valid `OPENAI_API_KEY` (or any other) in `.env`.
2. Send any message in the chat UI.
3. Observe the chip on the assistant bubble.

### Expected
Chip shows the provider + model that actually streamed (e.g. `openai / gpt-4o-mini`).

### Actual
Chip always shows `mock / mock-1`.

### Confirmed root cause
`apps/api/src/chat/chat.gateway.ts:238-250` constructs `StreamOrchestrator` with `provider: 'mock', model: 'mock-1'` as literals before the SDK commits to a provider. The orchestrator emits the WS `start` frame (per `WsStartFrameSchema` in `packages/contracts/src/ws.ts:62-71`) immediately on dispatch, so the truthful values from the SDK's `done` chunk (which lands on `inferences` + the OTel span) never propagate to the client.

The schema is the constraint: `WsStartFrameSchema` requires non-optional `provider: string` and `model: string` at `seq: 0` — there is no way to send `start` without provisional values.

### Acceptance
- Chat UI chip on each assistant message matches `inferences.provider` + `inferences.model` for that `message_id`.
- Matches OTel span attrs in Jaeger.
- No regression in mock mode (chip still shows `mock / mock-1`).

### Solution sketch (architect's call)
Two viable paths, pick at HLD:
- **A — Defer the `start` frame** until the SDK yields its first chunk (cheaper schema-wise; the orchestrator already buffers via `tryStreamUntilFirstToken` in the router, so the delay is the same one we already pay).
- **B — Add a `provider-resolved` outbound frame** type. Emit `start` immediately with provisional `provider/model: 'pending'`, then `provider-resolved` once the SDK commits. Requires schema change in `@argus/contracts` + a client handler.

A is simpler; B is more honest about the WS protocol. Senior-architect to decide.

---

## B2 — Assistant Markdown rendered as raw source

**Severity:** High (every real response is unreadable)
**Domain:** apps/web only

### Evidence
Screenshot shows raw `### Trip Planning for Bali`, `#### 1. **When to Go**`, `- **Best Time**: April to October (dry season)`, etc. in the assistant bubble — asterisks and hashes visible as text, no headings, no bold, no bullets.

### Repro
1. Real provider configured.
2. Send: `plan me a trip to bali`
3. Observe assistant response.

### Expected
Headings, bold, italics, ordered/unordered lists, inline code, fenced code blocks all render as HTML.

### Actual
Plain-text rendering of markdown source.

### Acceptance
- Headings (`#`..`####`), `**bold**`, `*italic*`, `-` / `1.` lists, `` `inline code` ``, ``` ```fenced code blocks ``` ``` all render.
- GFM tables and task lists render.
- **Security:** raw HTML in assistant output is sanitized (no `<script>`, no unsafe `href=javascript:`, no `srcdoc`). Worth a brief sanitizer audit during code review.
- **User messages are NOT rendered as markdown** (prevents user-input markdown injection from shaping the rendered conversation; user content stays plain).
- Streaming behavior preserved: partial markdown renders progressively as tokens arrive (a half-finished `**bold` should not crash the renderer).

### Solution sketch
`react-markdown` + `remark-gfm` + `rehype-sanitize` is the standard stack. Optional: `rehype-highlight` or `shiki` for code-block syntax highlighting (deferrable). Front-end-lead picks the exact deps.

---

## B3 — Zero conversation context + no remaining-token meter

**Severity:** High (model has no memory of prior turns; demo-killing for any multi-turn flow)
**Domain:** apps/api (gateway) + apps/web (chrome) + `@argus/contracts` (new frame field)
**Two sub-issues** bundled because they share the wire change:

### B3a — Conversation history not threaded into the SDK request
#### Confirmed root cause
`apps/api/src/chat/chat.gateway.ts:238` passes `messages: [{ role: 'user', content: frame.content }]` — i.e., the SDK only ever sees the single most-recent user message. There's a `computeOmittedCount` helper at `apps/api/src/conversations/context-window.ts` with the drop-oldest budget logic, but it is currently only consumed by the conversations REST controller for the "N earlier messages omitted" indicator. It is NOT used to build the SDK's `messages[]`.

#### Acceptance
- Multi-turn smoke test passes: send `my name is X`, then `what is my name?` — model recalls `X`.
- Default budget is **10,000 tokens** (raise `CONTEXT_TOKEN_BUDGET` default from `6000` → `10000`, or expose a new `CONTEXT_MAX_TOKENS` that takes precedence — naming call at HLD).
- Drop-oldest budget policy from HLD §D6 is honored; oldest user/assistant pairs evict first; the most-recent user message is never evicted even if it alone exceeds budget (matches existing helper behavior).
- The same token budget is the source of truth for both the SDK request shape AND the UI meter (B3b).

### B3b — UI meter showing remaining context budget
#### Acceptance
- Visible affordance in the chat surface that shows current consumption (e.g., `8.2k / 10k tokens`).
- Updates after every `done`/`end` frame.
- Source of truth: server-supplied (NOT a client-side estimate). Either:
  - Extend `WsEndFrameSchema` (`packages/contracts/src/ws.ts:85`) with `contextTokensUsed` + `contextTokensBudget`, OR
  - Extend `WsStartFrameSchema` to send pre-turn budget snapshot.
- Architect picks the carrier frame.
- On `/chat/[id]` mount, the initial budget snapshot comes from the existing conversations REST endpoint (so the meter renders before the first turn of a resumed conversation).

### Cross-coupling
B3a + B3b share the wire-format change. Land them together.

---

## B4 — Input box loses focus after send

**Severity:** Medium (slows iterative use; first thing every demo viewer notices)
**Domain:** apps/web only

### Repro
1. Type a message and press Enter (or click Send).
2. Wait for the response.
3. Try to type the next message — keystrokes go nowhere until you click back in the textarea.

### Expected
- Input remains focused after send completes.
- Input is focused on initial mount of `/chat` and on mount of `/chat/[id]`.
- Focus is NOT stolen mid-stream (would disrupt screen readers if user has tabbed to inspect the streaming response).
- Focus is NOT stolen on URL transition (`/chat` → `/chat/[id]`) — same mount-key counter discipline as the existing MessageStream hoist.
- User clicking elsewhere intentionally releases focus permanently (don't fight the user's explicit action).

### Acceptance
- Keyboard-only flow: send Enter, immediately type next prompt without touching the mouse, for 5 consecutive turns.
- No focus-trap regression (Tab still escapes the composer).

---

## B5 — Model picker dropdown in the input chrome

**Severity:** Medium (feature; needed for per-provider behavior testing + a real product affordance)
**Domain:** apps/web (chrome) + apps/api (new GET endpoint + WS request override) + `@argus/contracts` (frame addition) + `@argus/sdk` (honor per-request override)

### Evidence
Current chrome (Screenshot 2) shows a static `● auto-failover · 1 provider configured` pill. Non-interactive.

### Expected
- Clicking the pill opens a dropdown listing all configured models, grouped by provider:
  - `● Auto (failover)` — default
  - `OpenAI → gpt-4o-mini, gpt-4o, ...`
  - `Anthropic → claude-haiku-4-5, claude-sonnet-4-6, ...`
  - `Google → gemini-3-flash-preview, ...`
- Only providers whose API keys are configured appear.
- Selecting an entry pins subsequent turns of this conversation to that provider + model.
- "Auto" remains the default and is what new conversations get.

### Acceptance
- `GET /api/providers` returns `{ providers: [{ name, configured, models: [{ id, displayName, prompt_per_million, completion_per_million }] }] }`. Source: server-side registry (could re-use `cost.ts` pricebook keys + a provider config — architect's call).
- WS `WsSendFrameSchema` extended with optional `providerOverride` + `modelOverride`. SDK router (`packages/sdk/src/router.ts`) honors these by skipping priority order and trying only the named provider — no failover on explicit pin (the user picked it, fail loudly if it errors).
- Selection persists per-conversation. Architect to decide: server-side (new `conversations.pinnedProvider` + `pinnedModel` columns) vs client-side (localStorage keyed by conversationId). Server-side is cleaner for cross-device, client-side is simpler.
- Dropdown shows the per-1M-token cost next to each model (read from the `/api/providers` payload) — pairs naturally with the B3b context meter.

---

## Cross-cutting concerns

### Sequencing
- **B1 + B3 + B5** all touch `@argus/contracts` WS frames. Land them in this order so frame-schema churn is staged: B1 (frame addition or `start`-deferral) → B3 (frame field for context budget) → B5 (frame fields for overrides). If B1 picks Solution A (defer `start`), it's a no-op on the schema.
- **B2 + B4** are apps/web-only and can ship in parallel with anything.

### Effort estimates (rough, for slot-planning)
- B1: 1-3h (depends on solution A vs B)
- B2: 2-4h
- B3: 6-10h (api + web + contract + tests)
- B4: 0.5-1h
- B5: 4-7h (multi-package + endpoint + persistence design)

### Suggested PR slicing (architect/team-lead to confirm)
- **PR-A:** B1 (gateway provider label) — fast, unblocks honest UI signal for the others' QA.
- **PR-B:** B2 + B4 (web-only polish) — small, mergeable independently.
- **PR-C:** B3 (context threading + meter) — biggest; gates real multi-turn demos.
- **PR-D:** B5 (model picker) — depends on B1 for accurate displayed provider after pin.

### Confirmed code findings (saves the architect a discovery loop)
- `apps/api/src/chat/chat.gateway.ts:238` — only sends most-recent user message to SDK. (B3a)
- `apps/api/src/chat/chat.gateway.ts:249-250` — hardcoded `provider: 'mock'`, `model: 'mock-1'`. (B1)
- `apps/api/src/conversations/context-window.ts` — drop-oldest helper exists, unused by chat path. (B3a base)
- `packages/contracts/src/ws.ts:62-71` — `WsStartFrameSchema` requires non-optional `provider`/`model` at seq 0. (B1 schema constraint)
- `packages/contracts/src/ws.ts:85-92` — `WsEndFrameSchema` exists; no fields for context budget yet. (B3b carrier candidate)
- `packages/sdk/src/router.ts:60-101` — `defaultRouter.stream` walks priority order; needs an opt-out path when the gateway passes an explicit override. (B5)
- `packages/sdk/src/cost.ts` — pricebook keys = `${provider}:${model}`, can drive the dropdown listing. (B5)

### Out of scope
- Anthropic 4.x pricing verification (HANDOFF item #3) — separate.
- Workers integration tests baseline failure (HANDOFF item #2) — pre-existing, separate.
- otel-collector docker healthcheck (HANDOFF item, my PR #4 follow-up) — separate.
- Process-tree orphan leak on Ctrl-C in hybrid dev (HANDOFF item #5) — separate dev-ergonomics task.

---

## Handoff

Hand to `/oh` orchestrator. Team-lead to decompose into per-domain LLDs and assign to leads:

- **apps/api lead:** B1 (gateway), B3a (history threading), B5 (providers endpoint + request override plumbing)
- **apps/web lead:** B2 (markdown renderer), B3b (context meter), B4 (focus management), B5 (dropdown UI)
- **`@argus/contracts` co-owner:** any WS frame changes (B1-B, B3b, B5)
- **`@argus/sdk` co-owner:** B5 (router override path)

Reviewer assignments deferred to PR time.
