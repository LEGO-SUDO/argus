---
phase: prd
status: APPROVED
slug: argus
created: 2026-05-23
updated: 2026-05-23
---

# PRD: Argus — Inference Logging & Ingestion

## Problem

Argus provides a chatbot, an SDK that captures inference metadata, an ingestion pipeline, durable storage, README + architecture notes, and a demo. The operator reviews builds end-to-end: most projects ship the must-haves plus a few bonuses, few complete the full stretch bonus tier, and almost none deliver that *plus* a unifying narrative *plus* senior-level quality. Coherence beats feature count.

The risk this build must avoid — flagged by both cold-readers — is scope inflation that fragments the work into many half-finished features with no spine.

## Target Users

- **Primary — the operator** running Argus. They evaluate the build on velocity, pragmatism, product intuition, and observability literacy. First impression forms in the README and the first three minutes of the demo.
- **Secondary — the team running it in production.** This artifact becomes the credibility anchor for the first high-volume customer.

## Scope — Phase A: Chatbot Foundation

Phase A is the working product surface every operator exercises first. It must demo end-to-end before any Phase B work begins, because Phase B has nothing to show without a live stream of inference events.

- **A working chatbot** at `/chat`. Multi-turn conversation with limited recent conversation history (specific mechanics deferred to HLD). Reviewer types, bot streams back, conversation persists across reloads.
- **Authenticated identity.** The chatbot requires sign-in; new visitors can sign up with email + password. Conversations are scoped to the authenticated user — the list-conversations view shows only that user's threads. **Auth states:** failed login shows a clear inline error; duplicate-email signup is rejected with a visible message; logout is a one-click action available from the chat surface. To keep the keyless demo frictionless, the system seeds a demo account on first boot (credentials in README) so an operator can sign in immediately after the single-command boot; the seed is **idempotent** — re-booting against existing data does not overwrite or duplicate the user.
- **Multi-provider support** across OpenAI, Anthropic, and Gemini, with automatic failover. The UI shows which provider answered each turn. **Failover UX:** if the active provider fails before the first token, the system silently retries with the next configured provider; if it fails mid-stream, the turn is marked failed and the user is offered a retry button. Streams are never stitched across providers.
- **A mock provider on by default.** `docker compose up` on a clean machine boots the full stack with no API keys required and a real-looking streamed response appears in chat within ~60 seconds. The mock is **deterministic** — seeded by conversation and turn identifier so the same input always produces the same streamed output, making replay-against-mock a meaningful comparison rather than noise. README documents the one-line swap to real provider keys.
- **Real-time token streaming.** Tokens appear in the UI as generated, not after the full response completes. Each turn has a stable identifier carried through streaming, enabling future reconnect support without protocol change.
- **Conversation management:** list past conversations, open one and resume it (resume = send a new message in the existing thread — full history reloads, new turn streams), and cancel a streaming response mid-flight. The send control is disabled while a response is streaming so a second message cannot be queued mid-stream. **Cancel UX:** a canceled response is still recorded — it appears in the Traces feed marked as canceled, contributes to the Cost tab for tokens consumed up to the cancel point, and is excluded from Replay candidates. Cancel-before-first-token is recorded the same way, with zero tokens charged. Partial streamed output remains visible in the chat under the canceled marker.
- **Inference capture and storage from day one.** Every model call — real or mock — captures structured inference metadata (model, provider, latency, token usage, timestamps, status, conversation/session identifier, input/output previews); this metadata is ingested and lands in durable queryable storage. Non-optional in Phase A: Phase B reads exclusively from this data.

**Phase A exit bar.** An operator running `docker compose up` on a clean machine can sign in as the seeded demo user, hold a multi-turn conversation via the mock provider, list/resume/cancel, and confirm in storage that every turn produced a stored inference record — all within the first 60 seconds.

## Scope — Phase B: Control Plane (Differentiator)

Phase B is what separates this build from "must-haves plus bonuses." It is one `/console` surface with three tabs, all reading from the same inference data Phase A produces. **Three tabs on a shared foundation is the deliberate scope. Each tab depends on the same Phase A data; they are not three separate features.** The console is also scoped by authenticated user — every operator (real or seeded demo) sees only the inferences from their own conversations.

- **Traces tab.** Near-real-time feed of inference events — one row per model call with provider, model, latency, token counts, status, and a deep link to a full trace-detail view. The Observability-vocabulary hit ("observability stack", "near real-time") made concrete.
- **Cost tab.** Aggregated spend in **USD, rounded to cents**, broken down by provider, model, and conversation, with separate **prompt-cost** and **completion-cost** columns. Default time window is the last 24 hours; the operator can switch to all-time. Numbers tick up as new conversations happen. **Pricing source:** a pricing snapshot shipped with the app; README discloses it as a "pricing snapshot as of <date>" — best-effort, not authoritative. **Missing pricing for a provider/model:** the cost cell renders as "—" with a footnote ("no pricing entry; contributes zero to totals"). **Mixed mock/real-provider data:** each row is labeled with provider identity so mock-generated rows are visually distinct; the mock contributes zero real cost.
- **Replay tab.** The load-bearing demo. The operator picks a past inference from Traces, hits Replay, and re-runs the same input against *any* available provider — including the original provider (useful for testing non-determinism). UI shows original and replay side-by-side with cost delta, latency delta, and diffed output. **Eligibility:** successful, failed, and timed-out inferences are all replayable (Replay re-runs the input fresh); canceled inferences are excluded since "cancel" was a user action. **When the target provider is unavailable:** the UI shows that provider inline as "not configured" and offers one-click replay against the mock instead.

**Near-real-time staleness.** All three tabs reflect a new inference within roughly 5 seconds. During ingestion lag they show a "live, behind by Ns" indicator; on ingestion failure they show a clear error state rather than going silent.

**Phase B exit bar.** Within ~5 seconds of a user message being sent in `/chat`, the corresponding event is visible in Traces, contributes to Cost totals, and is available as a Replay candidate. One inference, enriched once, drives all three lenses.

## Edge Cases (Product-Level Behavior)

- **Empty `/console` (operator opens before any chat events):** each tab shows a friendly "no events yet — try sending a message in /chat" empty state with a deep link to `/chat`.
- **Refresh during active stream:** the stream is dropped (mid-stream resume is deferred); on reload the conversation shows the partial response marked "interrupted" with a retry button.
- **Context overflow:** oldest turns are dropped silently when the limit is reached; a small UI indicator shows "N earlier messages omitted from context."
- **All providers fail:** the chat surface shows a clear error ("no providers available — check configuration") with a link to the README provider-setup section.

## Non-Goals (This Submission)

- **Evals tab** — dropped on both cold-readers' advice as scope inflation.
- **True mid-stream resume** (reconnect to in-flight stream after a network drop) — the per-turn stable identifier keeps this open without a protocol break.
- **PII redaction** — secondary bonus tier, not stretch tier.
- **Hosted demo / Kubernetes deploy** — `docker compose up` is the primary demo surface.
- **Auth hardening** — email verification, password reset, OAuth providers, role-based access. Standard for a small-scale; deliberately scoped out.

## Success Criteria (Observable)

The operator can verify all of the following without external help:

- Every must-have core deliverable (chatbot, SDK, ingestion, storage) demos in under 60 seconds each.
- Every in-scope stretch bonus is present on the demo path: multi-provider, streaming, dashboards, Docker Compose, event-based architecture, cancel/list/resume.
- `docker compose up` on a clean machine, using the shipped default environment file, boots the full stack — including working chat via mock provider — in roughly 60 seconds.
- End-to-end propagation: a message sent in `/chat` shows up in all three `/console` tabs within roughly 5 seconds.
- **Replay is reachable from Traces in under 3 clicks** and renders cost delta, latency delta, and output diff against the chosen provider (real or mock).
- README architecture section includes one system diagram and addresses each of the operability vocabulary terms (*observability stack*, *near real-time*, *event-based architecture*, *high-velocity*, *high-volume*) in ≤2 sentences each, plus a "Why these tradeoffs" subsection for every Non-Goal.
- Observability-vocabulary check: the words *observability stack*, *near real-time*, *event-based architecture*, *high-velocity*, and *high-volume* each have a concrete, pointable answer in the app. (Deliberate — this is at small scale; the operator is grading against the spec.)

## Constraints

- **Build effort is unbounded — polish over speed.** Runtime budgets (60-second boot, 5-second end-to-end) are unrelated quality bars, not build-time pressure.
- **Mock-vs-real provider relationship.** The mock provider is the canonical demo path that works keyless. Real-provider support is the bonus path the operator can enable by adding API keys. Both paths are first-class; the app does not assume the operator will provide keys.
- **Single cohesive application surface** combining consumer chat and operator console under one product. README documents this as a deliberate demo-vs-prod tradeoff.

## Next Iteration (Documented in README as "Would Do Next")

Each deferred item gets a brief "here's how" sketch in the README so the operator sees the cut is informed, not ignorant:

- **Evals tab** — golden dataset shape, judge model, schedule, drift chart wireframe.
- **True mid-stream resume** — server-side stream buffer, sequence numbers, replay-on-reconnect; protocol is already forward-compatible.
- **Auth hardening** — email verification, password reset, OAuth providers, role-based access; the demo seeds a single demo user to keep the keyless path frictionless.
- **PII redaction** — secondary stretch bonus tier; out of scope for this round.
- **Hosted demo / Kubernetes deploy** — possible follow-up if the operator wants a URL instead of compose.

## Open Questions

- **Replay success definition.** Is "the diff renders and numbers are right" enough, or must the operator be able to replay across all three real providers in the same session (which forces them to provide keys)? Default absent answer: mock supports replay so the diff demo works keyless; real-provider replay is the bonus path documented in README.
- **Failover visibility in the demo path.** A happy-path demo will not surface failover unless we engineer a visible failure. Add a "force failover" demo button, or leave failover to the architecture notes? Default absent answer: surface the active provider per turn in the UI, no force-failover button.
- **Cost tab time granularity for a 60-second demo.** Ship seeded historical data so charts look populated, or start empty and let charts populate live? Default absent answer: start empty — more honest, less "the demo was rigged."
- **Hosted demo URL vs. compose-only plus Loom video.** Phase 4 decision; surfaced because it changes what "the demo" means for first contact.
- **Repo name on GitHub when published.** Phase 4 decision.
- **Dashboards: `/console` tabs only, or Grafana embedded alongside?** Phase 3a (HLD) decision; product-relevant because Grafana changes the operator's mental model from "one product" to "a product plus a stitched-in tool."

## Reviewer Concerns (acknowledged, not addressed in this PRD)

Raised by the Codex review gate; consciously left for later phases or out of scope:

- **Two browser tabs streaming the same conversation.** Out of scope for this build; design assumes a single active tab per user. Multi-tab coordination would require a per-conversation streaming lock — flagged for HLD if it becomes relevant.
- **Provider fails after returning metadata but before any output.** State-machine concern; the product-level rule is the same as "fails before first token" (silent retry with next provider). Implementation surface lives in HLD.
- **Output diff granularity** (line vs word vs semantic) for the Replay tab. Phase 3a HLD decision; product simply requires "the operator can see what changed."
- **Mock provider minimum quality.** Subjective; resolved at build time. Product requirement is "looks like a real streamed response to the operator for 60 seconds."
- **Token-count normalization for providers that report inconsistently.** Phase 3a HLD decision (already flagged in brief Open Questions).
