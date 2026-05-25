---
phase: pr
status: DRAFT
slug: chat-context-and-ux-polish
created: 2026-05-25
---

# PR Draft — Chat UX, Multi-Turn Context, and Provider Surface

---

## Title

```
feat(chat): truthful provenance chips, Markdown, multi-turn context, provider picker, and focus management
```

---

## Commit Messages

The branch already contains 33 commits. If squashing to a single merge commit
or opening as-is, the merge commit message can be:

```
feat(chat): B1-B5 UX polish bundle — provenance chips, Markdown, multi-turn
context, provider picker, and composer focus

Closes: chat-context-and-ux-polish spec (docs/oh/)

- B1: `start` frame is now identity-only (seq=0); a new `metadata` frame
  (seq=1) carries the committed provider+model sourced from the SDK's
  first-token `commit` signal — the per-message chip is never wrong, even
  briefly during streaming.

- B2: AssistantMessageContent renders via react-markdown + remark-gfm +
  rehype-sanitize. URL-scheme guard defeats encoded javascript:/data:/
  vbscript: bypasses. Raw HTML is inert; user messages stay plain text.

- B3: ChatService.startTurn persists the user message then reads history
  inside the same transaction (drop-oldest, 10k-token default budget,
  latest user message never dropped). Server-supplied context meter
  (tokensUsed/tokensBudget) rides the `end` frame and the messages-list
  response; ContextMeter component renders the fraction on first paint.

- B4: useFocusComposer keeps keyboard focus across send, mount, and URL
  swap from /chat to /chat/<id>.

- B5: ProviderPicker combobox/listbox (WAI-ARIA 1.2) sourced from
  GET /api/providers; per-conversation pin persisted server-side
  (pinnedProvider/pinnedModel columns, migration 0003); pin override
  bypasses SDK failover; resume-time fallback-to-Auto with a one-time
  inline notice when the pinned model is no longer configured.

New OTel span attrs: llm.context_budget_effective, llm.context_window_cap,
llm.pinned_failure, llm.guess_commit_divergent. Structured events for
context truncation, pin fallback, and meter-compute failure.

540 tests green (contracts 39 / sdk 95 / api 164 / web 242).
```

---

## Description

### Summary

This bundle closes five gaps that made the chat surface feel unfinished on
first contact: the per-message provenance chip was always wrong, assistant
responses arrived as raw Markdown source, the model had no memory of prior
turns, the composer lost focus after every send, and the model picker was a
static non-interactive label. All five are fixed together because three of
them share the same WebSocket wire contract, which is revised once in this PR.

The changes are coordinated across the full stack: wire-protocol contracts,
SDK router, API gateway and service layer, database schema, and the web chat
surface. Planning artifacts live in `docs/oh/chat-context-and-ux-polish/`.

### Changes

**B1 — Truthful provenance chip**

The `start` frame (seq=0) is now identity-only: `messageId`, `conversationId`,
`seq`. A new `metadata` frame at seq=1 carries `providerMeta { provider,
model }`, emitted exactly once per turn at the moment the SDK's chosen adapter
yields its first non-empty token (the `commit` signal). The chip is never
populated from a pre-flight guess. During streaming the chip shows an ellipsis;
on the pre-token failure path (`start → error → end`) the chip transitions
directly to a failure state without ever displaying a provider name.

This is a one-way-door wire change. Every exhaustive `switch` consumer
(contracts tests, stream-orchestrator, frame-builder, web reducer) is updated
in the same PR.

**B2 — Markdown rendering**

`MessageContent` renders assistant turns through `react-markdown` +
`remark-gfm` + `rehype-sanitize`. The sanitize schema is derived from
`rehype-sanitize`'s GitHub-style default and tightened to allow only
`http`/`https`/`mailto` on `href` and `http`/`https` on `src`. A pre-sanitize
URL-scheme guard (`rehypeUrlSchemeGuard`) runs first in the rehype pipeline;
it normalizes every `href`/`src` — lowercasing, stripping leading control
characters, decoding HTML entities and percent-encoding — before checking
the allow-list. This closes the encoded bypass (`jav&#x61;script:`,
`%6a%61vascript:`, etc.). Raw HTML in assistant output is escaped to plain
text (no `rehype-raw`). User messages remain plain text throughout.

**B3 — Multi-turn context and context meter**

`ChatService.startTurn` now persists the user message and reads prior history
inside a single database transaction, ensuring a concurrent second send on the
same conversation cannot contaminate the history seen by either turn. History
assembly uses a drop-oldest strategy against a configurable token budget
(default 10,000 tokens; capped to the pinned model's published context window
when smaller). Only `status: complete | canceled | failed` messages enter
history — in-flight streaming rows are excluded.

The `end` frame for completed turns now carries `tokensUsed` and
`tokensBudget` (absent on failed/canceled). The `GET /api/conversations/:id/messages`
response carries the same fields so the `ContextMeter` component can render
the correct fraction on the first paint of a resumed conversation.

**B4 — Composer focus**

`useFocusComposer` fires `focus()` at exactly three moments: on mount, on the
falling edge of the streaming lock (turn completes), and on every
`conversationId` change (URL swap from `/chat` to `/chat/<id>`). It does not
steal focus mid-stream and does not re-focus on arbitrary re-renders.

**B5 — Provider picker**

`ProviderPicker` is a WAI-ARIA 1.2 combobox/listbox dropdown sourced from
`GET /api/providers`, which returns every provider whose credentials are
currently configured, with per-model prompt/completion costs and context-window
sizes. Two nullable columns (`pinned_provider`, `pinned_model`) added to the
`conversations` table via migration `0003_conversation_pin`. `PATCH
/api/conversations/:id` validates the incoming pin against the live catalog
before persisting; invalid pairs are rejected 4xx. When a pinned model is no
longer configured at read time, the messages-list response carries
`pinFallback: true` + `previouslyPinned` and falls back to Auto for the next
turn; the persisted row is not mutated until the user explicitly changes the
pin.

**Observability**

New OTel span attributes on the chat turn span: `llm.context_budget_effective`,
`llm.context_window_cap`, `llm.pinned_failure`, `llm.guess_commit_divergent`.
Structured events for context truncation, pin fallback, and meter-compute
failure (meter failure is non-fatal — the `end` frame still ships with
`tokensUsed: null`).

### Context

**Why one PR for all five items?** Three of the five touch the same
discriminated union in `packages/contracts/src/ws.ts`. An intermediate state
where the `start` frame still carries provider/model but the reducer already
expects a `metadata` frame is not a valid build. The coordinated backbone is
the minimum atomic unit that compiles and passes all type checks.

**Wire protocol is a one-way door.** The `seq` invariant (`start@0 →
metadata@1 → token@2..N → terminal`) and the `WsStartFrameSchema` using
`.strict()` (rejecting extra keys) are enforced at schema level. Any future
client that has not been updated will receive frames that fail the old schema.
Rolling back means re-adding `provider`/`model` to `start` — do not do this
without updating all consumers simultaneously.

**Markdown rendering is also a one-way door (HLD D7).** Rollback post-launch
changes user perception of all existing messages. The sanitize policy is
intentionally conservative; relaxing it later is safer than tightening.

**Prisma migration is forward-only.** `0003_conversation_pin` adds two
nullable columns; rollback requires shipping a new forward migration that drops
them. The `pinnedProvider`/`pinnedModel` columns are nullable so the migration
is safe against existing conversations.

**SDK failover is byte-identical when no pin is set.** The override branch in
the router is a fully separate code path — not a flag inside the failover loop.

**Demo credentials:** `demo@argus.dev` / `let-me-in-9`

### Deferred / Follow-up

- **Markdown Playwright screenshot baseline** (`tests/e2e/specs/markdown-rendering.spec.ts`):
  the spec is in place and the fixture (`apps/web/__tests__/fixtures/markdown-payload.md`)
  is committed, but the baseline PNG requires a live compose stack to generate.
  Run `pnpm --filter @argus/e2e test -- --update-snapshots specs/markdown-rendering.spec.ts`
  against a running stack before merging if screenshot diffing is required.
- **Task 90 — Jaeger trace smoke test:** local-infra-only follow-up; no
  production code change required. Verify `llm.guess_commit_divergent` and
  `llm.pinned_failure` attrs appear on turn spans in Jaeger after a pinned
  turn and a divergent-guess turn.
- **Planning artifacts:** this PR includes `docs/oh/chat-context-and-ux-polish/`
  (PRD, HLD, LLDs, Codex review artifacts). These are first-class project
  documentation and are intentionally committed.

### Test Coverage

- **540 unit/integration tests green:** contracts 39, sdk 95, api 164, web 242
- **5 typecheck targets pass** (`contracts`, `sdk`, `api`, `web`, `e2e`)
- **`next build` clean** — no SDK bundle leak into the client bundle
- **Forbidden-ref grep clean** — no stray internal references in
  production paths
- **Playwright E2E specs** committed for all five features (provider-picker,
  focus, multi-turn-mock, multi-turn-real [env-gated], markdown-rendering
  [snapshot baseline deferred])

---

## QA Test Plan

Stack startup:

```bash
pnpm compose:up       # full Docker stack (Postgres + Redpanda + OTel collector + API + web)
# OR for hybrid dev:
pnpm dev:api          # in one terminal
pnpm dev:web          # in another
```

Sign in as `demo@argus.dev` / `let-me-in-9` for all manual steps below.

---

### B1 — Provenance chip truthfulness

**Setup:** `MOCK_PROVIDER=true` (default `.env.example`). No real API keys
needed for the chip mechanics.

- [ ] Start a new conversation, send any message. While the turn is streaming,
      observe the provider chip on the assistant bubble. It must show an
      ellipsis (neutral provisional state), not a provider name.
- [ ] Wait for the stream to complete. The chip must update to show `mock` and
      the model identifier (e.g. `mock-1`). It must not show a blank or keep
      the ellipsis.
- [ ] Send a second message in the same conversation. The chip on the new
      assistant bubble follows the same ellipsis → committed label sequence.
      The first message's chip does not change.
- [ ] Simulate a pre-token failure (e.g. kill the API mid-send, or use a
      deliberately bad pin — see B5 pin-failure below). The chip on the
      failing message must transition from ellipsis directly to a failure
      indicator. It must never display a provider name.

**Expected:** chip value after a completed turn matches the value stored
against that message in the `messages` table (`provider`/`model` columns)
and the Jaeger span for that turn.

---

### B2 — Markdown rendering

**Setup:** `MOCK_PROVIDER=true` is sufficient. The mock adapter returns
whatever the client sends reflected back, but for the markdown check you
need a real provider or a seeded response. Use a real provider key if
available; otherwise inject a seeded response via the mock adapter or
test with the unit-test fixture.

**Readability check (real provider required for full fidelity):**

- [ ] Open a new conversation. Send: `Plan me a trip to Bali.`
- [ ] Wait for the response. The assistant reply must render with visible
      headings (larger text or bold section titles), bullet or numbered lists,
      and bold/italic text. Raw asterisks, hashes, and dashes must not appear
      in the rendered output.
- [ ] Scroll through the response. No layout overflow, no broken list nesting,
      no raw Markdown syntax leaking through.

**User messages stay plain:**

- [ ] Send a message containing `**bold** and *italic*`. The user bubble must
      display the literal asterisks — not rendered bold/italic.

**Streaming safety:**

- [ ] On a slow connection or with a rate-limited provider, observe the
      assistant bubble while a long response is still streaming. Partial
      Markdown (e.g. an unclosed code fence or an in-progress list) must not
      crash the page or cause a blank bubble.

**XSS / unsafe link guard:**

- [ ] Verify that an assistant response containing raw `<script>alert(1)</script>`
      is rendered as the literal text `<script>alert(1)</script>` — no alert
      fires, no element is injected into the DOM.
- [ ] Verify that a Markdown link `[click me](javascript:alert(1))` renders as
      plain text (the link element is stripped) or is otherwise inert — no
      navigation occurs, no alert fires.
- [ ] Verify that a Markdown link `[visit](https://example.com)` renders as an
      active link that opens in a new tab (`target="_blank"`) with
      `rel="noopener noreferrer"`.
- [ ] Verify that a Markdown link to the same origin (e.g. `/settings`) opens
      in the same tab without `rel="noopener"`.

---

### B3 — Multi-turn context and context meter

**Multi-turn memory check (real provider required):**

- [ ] Start a new conversation. Send: `My name is Priya. Remember it.`
- [ ] Wait for the response to complete.
- [ ] Send: `What is my name?`
- [ ] Wait for the second response. It must contain "Priya" without further
      prompting. If it says it has no memory of prior turns, the history
      assembly is broken.

**Multi-turn memory check (mock, degraded):**

- [ ] With `MOCK_PROVIDER=true`, send `My name is Priya.` then `What is my name?`.
      The mock adapter echoes input and does not simulate memory — this step
      verifies the history rows are forwarded to the SDK (visible in API logs
      as a `messages` array with 2+ entries on the second request), not that
      the mock "remembers".

**Context meter — fresh conversation:**

- [ ] Send a message and wait for the response to complete. The context meter
      (fraction display, e.g. `0.5k / 10k tokens`) must appear below the
      message list or composer area.
- [ ] The displayed budget must be `10k` (the configured default) when no
      model is pinned.
- [ ] Send a second message and wait for it to complete. The token count in
      the meter must increase.

**Context meter — resumed conversation:**

- [ ] Navigate away from the conversation (go to the sidebar, click another
      conversation or the new-chat button).
- [ ] Navigate back to the original conversation. On first paint — before
      sending any new message — the context meter must display the token
      fraction from the last completed turn (not blank).

**Context meter — pinned model cap:**

- [ ] Pin a model with a small published context window (e.g., if a model
      exposes 8k tokens). The meter budget must reflect the smaller of 10k and
      8k — i.e. `8k` — not `10k`.

---

### B4 — Composer focus

- [ ] Open a brand-new conversation (`/chat`). Without clicking anywhere, the
      composer textarea must already hold keyboard focus on first paint.
- [ ] Type a message and press Enter (no mouse). The message sends.
- [ ] After the turn completes (stream ends), the composer must regain focus
      automatically. Type the next message without clicking. Repeat for five
      consecutive turns — the composer must stay focused between turns
      throughout.
- [ ] On the first send of a new conversation, the URL changes from `/chat` to
      `/chat/<uuid>`. The composer must remain focused across that URL
      transition.
- [ ] While a turn is streaming, click somewhere else in the page body to
      intentionally move focus. The composer must NOT steal focus back until
      the stream completes.

---

### B5 — Provider picker

**Happy path — select and send:**

- [ ] Open a new conversation. Click the provider-picker pill (currently shows
      "Auto"). The dropdown must open and list every provider whose credentials
      are configured. With `MOCK_PROVIDER=true`, the list must include the mock
      provider entry.
- [ ] Each model row must show a cost string (e.g. `$0.15 / $0.60 per 1M`) or
      `—` for entries without known pricing.
- [ ] Select a specific model (e.g. `mock / mock-1`). The dropdown must close.
      The trigger pill must update to show the selected provider and model.
- [ ] Send a message. The assistant chip after the turn completes must show the
      pinned provider and model — not "Auto" or the default failover provider.

**Picker disabled during streaming:**

- [ ] While a turn is actively streaming, attempt to click the provider-picker
      trigger. It must not open. The trigger must be visually disabled.
- [ ] After the stream completes, the picker must become interactive again.

**Auto switch:**

- [ ] While a model is pinned, open the picker and select "Auto". The trigger
      must revert to "Auto". Send a message — the next turn uses the default
      failover router (chip shows whatever provider the router chose, not the
      previously pinned one).

**Pin persistence across refresh:**

- [ ] Pin a model, send one message, wait for it to complete.
- [ ] Hard-refresh the page (Cmd+Shift+R / Ctrl+Shift+R).
- [ ] The picker trigger on first paint must show the pinned provider/model —
      not "Auto". The pin was persisted server-side.

**Empty-catalog state (no credentials configured):**

- [ ] With all API keys removed from `.env` and `MOCK_PROVIDER=false` (or unset),
      restart the API. Open a conversation. The provider-picker pill must still
      be visible but non-interactive. Clicking it must not open a dropdown;
      instead it must show a message naming the relevant environment variables
      (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`). The trigger
      label must read "Auto".

**First-turn pin edge case:**

- [ ] Open a brand-new conversation (no conversation row exists yet). Select a
      model from the picker before sending any message. Send the first message.
      The model must be pinned (the PATCH must be issued after the conversation
      row is created on the first send). The chip on the response must show the
      selected model.

**Pin fallback — model no longer configured:**

- [ ] Using the database or a direct SQL update, set `pinned_provider` and
      `pinned_model` on an existing conversation to a provider/model pair that
      is NOT currently configured (e.g. `openai` / `gpt-5` with no OpenAI key
      set, or any string not in the live catalog).
- [ ] Navigate to that conversation. A one-time inline notice must appear
      naming the previously-pinned model and stating the conversation has
      fallen back to Auto.
- [ ] The picker trigger must show "Auto".
- [ ] Send a message. The turn must stream from an available provider (not fail
      with a pin error).
- [ ] Refresh the page. The fallback notice must NOT appear again (it is
      one-time, keyed to the session-level `pinFallback` flag in the response).

**Pin failure — pinned provider errors:**

- [ ] Pin a provider that is configured but will fail (e.g. set an invalid API
      key for the pinned provider while keeping the key set so it passes the
      catalog check, or simulate a 500 from the provider). Send a message.
- [ ] The conversation must show a clear error attributed to that provider.
      There must be no silent fallback to another provider (the chip must not
      switch to a different provider's name — it must show a failure state).

---

### Regression Areas

These features share code paths with this change. Verify they continue to
work as before:

- [ ] **Existing conversations (pre-PR messages):** Open a conversation that
      was created before this PR. Old assistant messages that do not have
      provider/model metadata (no `metadata` frame was emitted for them) must
      render without a chip or with a graceful placeholder — not a crash.
- [ ] **Cancel a streaming turn:** Send a message, then cancel before it
      completes. The `end` frame with `status: canceled` must arrive. The
      context meter must NOT update for a canceled turn (no `tokensUsed` on a
      non-complete terminal). The composer must re-enable.
- [ ] **WebSocket reconnect:** Close and reopen the browser tab mid-stream.
      The in-flight turn should either complete or land in a failed state
      gracefully. No ghost streaming rows should remain in `status: streaming`
      permanently.
- [ ] **New conversation flow:** Navigate to `/chat` (the new-conversation
      route). Send a message. The URL must transition to `/chat/<uuid>`. The
      composer must be focused throughout. The conversation must appear in the
      sidebar.
- [ ] **Conversation list and title:** The sidebar conversation list must still
      load and render. The title of the active conversation must still appear
      in the header.
- [ ] **Auth boundary:** Accessing `GET /api/providers` while unauthenticated
      must return 401. The `PATCH /api/conversations/:id` pin endpoint must
      reject unauthenticated requests with 401 and requests for another user's
      conversation with 404.

---

### Environments

- [ ] Verified on local dev stack (`pnpm compose:up` or hybrid `pnpm dev:*`)
- [ ] Chrome / Chromium (primary)
- [ ] Safari or Firefox (secondary — verify picker keyboard navigation and
      focus behavior, which differ between browser focus-management models)
- [ ] Mobile viewport (375px wide): picker dropdown must not overflow the
      viewport; context meter must wrap or truncate gracefully

---

## Rollback Plan

Revert the merge commit. Because the wire protocol changes are coordinated
across contracts/SDK/API/web in a single PR, a partial revert is not safe —
revert the whole merge.

Additional considerations:

- The Prisma migration `0003_conversation_pin` adds two nullable columns. If
  you revert the application code after the migration has run in production,
  the columns remain in the database but are ignored by the reverted code —
  this is safe. To fully clean up, ship a new forward migration that drops
  `pinned_provider` and `pinned_model` from `conversations`.
- There are no external service-side changes (no webhook registrations, no
  queue schema changes, no feature flags) beyond the database migration.

---

## Checklist

- [x] Tests added / updated (540 passing: contracts 39 / sdk 95 / api 164 / web 242)
- [x] Playwright E2E specs committed for all five features
- [x] 5 typecheck targets pass
- [x] `next build` clean — no SDK code in client bundle
- [x] Forbidden-ref grep clean
- [x] No secrets in diff
- [x] No debug code left behind
- [x] Prisma migration committed alongside application code that depends on it
- [x] `.env.example` updated with new env vars
- [ ] Markdown Playwright screenshot baseline generated (deferred — requires live stack; see Deferred section)
- [ ] Task 90 Jaeger trace smoke test (deferred — local infra only)

---

## Unverifiable Claims

The following claims in this description could not be fully verified from
static analysis alone. The user should confirm before merging:

1. **"the chip value matches the value stored in the `messages` table"** —
   verified structurally (the `metadata` frame is sourced from the SDK
   `commit` chunk which carries the committed adapter's identity, and
   `completeTurn` persists the same provider/model), but a live spot-check
   against three random messages across real providers is recommended per the
   success criterion.
2. **"multi-turn 'what is my name?' works against each configured real provider"** —
   the unit tests confirm history is assembled and forwarded; the Playwright
   `multi-turn-memory.spec.ts` is env-gated (`REAL_PROVIDER=openai`) and
   requires a valid API key to run. CI does not exercise this path.
3. **"no silent fallback when a pinned provider errors"** — the SDK override
   branch is a separate code path from the failover loop (verified in
   `router.test.ts`), but a live test with a deliberately broken API key is
   the definitive check.
