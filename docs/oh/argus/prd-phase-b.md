---
phase: prd
status: APPROVED
slug: argus
scope: phase-b
created: 2026-05-24
updated: 2026-05-25
revision: 3
---

# PRD: Argus — Phase B (Control Plane)

## Problem

Phase A captures inference metadata but does not expose it. Phase B builds the operator-facing surface that turns that captured stream into observability, cost literacy, and cross-provider insight — shifting the question from *"does the chatbot work"* to *"can we see, price, and reason about every model call in production."*

## Target Users

- **Primary — the operator.** A few minutes in `/console` to confirm the inference pipeline is healthy, on-budget, and reproducible.
- **Secondary — the team running it in production.** The template for a first high-volume customer's inference stack.

## Scope

Phase B is one `/console` surface, auth-scoped per user (same session as `/chat`), with three tabs: **Traces**, **Cost**, **Replay**. All three are lenses on the inference data Phase A captures.

### Real-provider integration

`/chat` exposes a provider selector with four options always visible: **Auto** (default), OpenAI, Anthropic, Gemini. Providers without configured keys appear disabled with a tooltip explaining they're unconfigured. Mock remains available as the default only when no real keys are configured at all — Mock is never silently substituted for a real provider.

**Auto routing.** Auto triggers a small classifier model call before the main provider call to categorize the user message (coding / research / general) and route to Anthropic / Gemini / OpenAI accordingly. Auto-routed turns produce **two inferences per turn** (classifier + main call). Both are visible in Traces and both contribute to Cost.

**Failover policy.** On a failed attempt, the chain tries the user-selected provider first, then OpenAI → Anthropic → Gemini, skipping any already-tried provider. Maximum 3 attempts total. Mock is never in the failover chain. Failover triggers: network errors, timeouts, 429, 401/403, 5xx. Safety refusals are valid responses, not failures — they surface to the user with a clear "blocked by provider safety filter" indicator and do not trigger failover. When all real providers fail and Mock is available, the user sees an explicit failure with a retry control — no silent Mock substitution.

### Traces tab

Chronological feed of inference events, newest first, auto-updating as new turns arrive. Each row shows provider, model, status (succeeded, failed, canceled, timed-out), latency, prompt and completion token counts, conversation reference, and timestamp. Token counts that arrive late render initially as "—" and enrich within ~5s.

**Throughput strip.** Top-of-tab summary showing turns/hour, tokens/hour, and error rate for the active time window. Both the strip and the error-rate denominator count **user-originated chat turns only** — excluding classifier inferences, replay runs, and sample-data inferences — to give a clean signal of real user activity.

**Failover visibility.** A turn that succeeded after retries is expandable inline to show the full attempt chain (user message preview, error class and message, status, tokens, model, timestamp per attempt).

**Filters and search.** Provider, model, status, and conversation filters are combinable (ANDed). A single free-text search box matches input preview, output preview, conversation title, and error class/message, ranked by recency. Time window toggles between 24h, 7d, and all-time and mirrors the Cost tab.

**Conversation reference.** Rendered as a clickable conversation title that filters Traces to that conversation. Deleted conversations render as the original title with " (deleted)" appended, still clickable.

**Replay-run badge.** Replay-run inferences appear with a clear badge so the operator can see Replay is doing real work through the same pipeline.

### Cost tab

Aggregated spend in USD, grouped by conversation by default with one-click regrouping by provider or model. Each row shows prompt cost, completion cost, and total. Time window defaults to 24 hours with toggles for 7 days and all-time. Header shows total spend for the window plus a sparkline of per-hour spend.

**Calculation.** Costs are stored as exact micro-USD amounts; all math operates on exact values. The UI rounds only at display time, with totals computed from raw values then rounded once. Amounts below $0.005 render as "< $0.01".

**Pricing.** A fixed pricing table ships with the app — no dynamic updates. Mock-provider rows are visually distinct and excluded from Cost totals by default (toggle to include them for pipeline-math validation). Replay runs are likewise excluded from Cost totals by default — even canceled replays with partial tokens stay out — with the same include toggle.

**Mixed-priced groupings.** When a group contains models without pricing entries, the total renders as a partial with an inline badge (e.g., *"$0.42 (2 rows missing pricing)"*). Hover or click on the badge lists the unpriced models.

**Drilldown.** Clicking a conversation row opens Traces filtered to that conversation.

### Replay tab

The load-bearing demo. The operator picks a past inference from Traces — successful, failed, timed-out, or canceled — and opens a Replay detail view. Canceled inferences are eligible with a "partial input only" warning. Candidates respect the active Traces time window; changing the window while a Replay detail is open leaves that detail unaffected but narrows the candidate set for the next selection.

**Original metadata.** The detail view surfaces whatever was captured: provider, model, latency, tokens, cost, input, output. Missing fields render as "—" with the captured error visible. The exact original input for replay is: system prompt, the user message that triggered the turn, full conversation history up to that turn, temperature, and max-tokens. Tools, attachments, and provider-specific parameters are excluded — chat is text-only and cross-provider replay needs a portable parameter set.

**Replay against deleted conversation.** Allowed. Inference metadata persists on conversation delete; the conversation reference renders as "(deleted)" inline.

**Re-run.** The operator picks a target provider and model from independent pickers; a "reset to original" restores the original pair in one click. Unavailable providers appear disabled with inline help offering Mock as an alternative. Replaying against the original provider is allowed (useful for non-determinism testing).

**Side-by-side view.** Results render side-by-side with deltas for cost and latency, plus a word-level highlighted diff of the output. A toggle switches between the highlighted diff and raw side-by-side panes. Each pane has an expand control opening the full content in a scrollable detail view.

**Failure handling.** When either side has no output or errored, the diff is not rendered. The pane shows a clear inline message describing what failed (e.g., *"Replay failed: rate limited"*, *"Original was canceled — no output to compare"*). Whatever metadata is available is always shown.

**Persistence.** Replay runs are persisted as new inferences tagged as replay runs. They appear in Traces with a badge and are excluded from Cost totals by default.

### Live update behavior

All three tabs reflect a new inference within roughly 5 seconds. A persistent badge in each tab header has exactly three states:

- **Live (green)** — lag between the newest persisted inference and wall clock is under 5 seconds, *or* there is no traffic at all (both treated the same).
- **Behind by Ns (amber)** — lag is 5 seconds or more, showing the actual N.
- **Ingestion failure (error, with retry control)** — no heartbeat from the ingestion path for 30 seconds. (The heartbeat is a low-rate pipeline health signal; HLD wires the mechanism.)

### Empty-state and sample data

A operator opening `/console` before any traffic sees a friendly empty state on each tab with a deep link to `/chat` and a "Generate sample inferences" button that seeds a handful of synthetic inferences (varied models, varied conversations) so all tabs populate immediately.

**Lifetime.** Sample data is scoped to the current auth session (cookie). Logout + new login = fresh session with no sample-data visibility from the prior session. Per-user isolation is preserved across sessions of the same user — a re-login never sees another user's data.

**Coexistence with real data.** When real and sample data both exist, real rows sort first by default with a toggle to show sample inferences. Sample rows are visually distinct.

**Clear control.** Clear wipes *all* inferences for the user — real chat-originated, replay runs, and sample. Triggered via a type-to-confirm modal that shows an exact breakdown (e.g., *"This will delete 47 inferences — 32 chat-originated, 8 replay runs, 7 sample inferences"*) and requires the user to type `CLEAR`. Cancel is always available. If chat streams or replay runs are in flight, Clear aborts them first (modal briefly shows "aborting active operations...") then completes the delete.

### Cross-cutting behaviors

- **Provider safety-filter / refusal output:** surfaced explicitly in `/chat` ("response was blocked by provider safety filter") and as a distinct status in Traces.
- **Missing token counts:** field renders as "—"; reason captured for debuggability.
- **Model in traces but absent from pricing:** cost renders as "—" with a "missing pricing" footnote; the row is excluded from Cost totals.
- **Conversation rename or delete:** conversation ID is canonical, never the title. Deleted conversations preserve their inference metadata; the reference shows "(deleted)" inline.
- **Canceled inferences with partial tokens** *(non-replay):* status=canceled with an inline note that only partial data was captured; they contribute to Cost since tokens consumed are real spend.
- **Multi-tab usage** (`/console` open while `/chat` streams): `/console` reflects new inferences live via the same mechanism that powers the live badge.

## Non-Goals

Carried from Phase A: Evals tab, true mid-stream resume, PII redaction, hosted deploy, auth hardening.

New to Phase B:
- Custom date-range picker on Cost or Traces (24h / 7d / all-time covers the demo).
- Multi-conversation Replay (re-running a whole conversation against a different provider).
- Export of Traces or Cost data.
- Alert thresholds or budget warnings on Cost.
- An external dashboard tool embedded alongside `/console`.

## Success Criteria

An operator can verify all of the following independently:

- A chat turn routes to the selected provider (or the Auto-routed provider); the answering provider is visible in `/chat` per turn and in Traces per row. *(requires real keys for non-Mock turns)*
- With one configured provider deliberately broken, the next turn fails over within the 3-attempt budget and the Traces row shows the full attempt chain. *(requires real keys)*
- An Auto-routed turn produces two visible Traces rows (classifier + main call), both attributed to the same chat turn. *(requires real keys)*
- Within roughly 5 seconds of a new chat turn, the inference appears in Traces, contributes to Cost totals (when real), and is selectable as a Replay candidate.
- Cost totals match a hand-calculation against the shipped pricing table for a small set of inferences.
- A mixed-priced grouping shows the partial-total badge and lists the unpriced models on hover.
- Replay is reachable from Traces in under 3 clicks and renders cost delta, latency delta, and word-level output diff against the chosen target — including Mock when no real key is configured.
- A canceled inference is selectable in Replay and produces the "Original was canceled — no output to compare" message in the original pane.
- The Traces throughput strip shows non-zero turns/hour and tokens/hour after a short demo session (classifier and replay inferences excluded from the count).
- The live badge transitions green → amber when ingestion is artificially lagged, → error when the heartbeat is killed for 30s, and recovers when restored.
- The "Generate sample inferences" button populates all tabs in under 5 seconds; Clear opens the type-to-confirm modal with an accurate count and returns the user's data to empty.
- Observability-vocabulary check: the operator can point at concrete surfaces in `/console` for *Latency* (Traces row), *Throughput* (Traces strip), and *Errors* (Traces strip and status column).

## Open Questions

- **Scope size acknowledgment.** Cross-model review (Codex) raised 8 scope-creep risks across the three tabs (real providers + Auto classifier + failover with attempt chain + word-level diff + Cost grouping/drilldown/sparkline + Live badge state machine + sample-data lifecycle + Replay provider/model matrix). User answers expanded scope rather than cut it. The PRD locks at this scope; if delivery pressure forces a cut, the easiest descopes in order are: drop Auto routing classifier (simplify to keyword heuristic), drop word-level diff (raw side-by-side only), drop sample-data Generate/Clear flow (start empty, document keyless demo loads slowly). Operator concerns acknowledged: word-level diff polish, live badge complexity, sample-data lifecycle, classifier-as-second-inference.

## Constraints

- **Build effort is unbounded — polish over speed.** The 5-second end-to-end runtime budget is a quality bar, not build-time pressure.
- **Phase B reuses Phase A's data foundation.** Phase B may add columns or supporting tables for replay-run tagging and sample-data scoping, but does not introduce a parallel ingestion path or duplicate the inference data model.
- **Real-provider keys are operator-supplied.** The keyless Mock path remains the default; success criteria requiring real keys are labeled inline.
- **One cohesive product surface.** `/chat` and `/console` share the same auth and are documented as a deliberate demo-vs-prod tradeoff. Phase B does not split them.
