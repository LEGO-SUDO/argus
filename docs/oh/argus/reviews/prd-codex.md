## 1. Format violations

1. **Architecture decision:** “lands in Postgres.”  
   Move to **HLD**. PRD should say durable queryable storage, not pick the database.

2. **Transport decision:** “WebSocket streaming.”  
   Move to **HLD** unless the original brief explicitly mandates WebSockets. Product requirement is streamed responses.

3. **Architecture decision:** “through an SDK wrapper into the ingestion pipeline.”  
   Move to **HLD**. Product need is inference metadata capture and ingestion.

4. **Architecture decision:** “Collapsed to one Next.js app with route splits.”  
   Move to **HLD**. Product can require one cohesive app surface.

5. **Implementation detail:** “short context window (last N turns, hard-capped at ~6k tokens, oldest-dropped, no summarization).”  
   Move to **HLD/LLD**. PRD should state expected conversation continuity and limits at product level.

6. **Route/path specificity:** “at a `/chat` route” and “single `/console` surface.”  
   Acceptable if these are product navigation requirements, but if treated as implementation paths, move to **HLD**.

## 2. Underspecified requirements

1. **Provider failover — Phase A**  
   Missing: what the user sees when failover happens, whether retries are automatic, and how partial streamed output is handled.  
   Engineer would ask: if provider A fails mid-stream, do we restart the answer with provider B or mark the turn failed?

2. **Cancel streaming — Phase A**  
   Missing: whether a canceled response is saved, billed/logged, resumable, or excluded from replay.  
   Engineer would ask: should canceled calls appear in Traces and Cost?

3. **Conversation persistence — Phase A**  
   Missing: user/session identity model.  
   Engineer would ask: are conversations browser-local, anonymous server sessions, or user-authenticated?

4. **Replay — Phase B**  
   Missing: expected behavior when the replay provider lacks credentials or is unavailable.  
   Engineer would ask: should replay fall back to mock, block with setup instructions, or hide unavailable providers?

5. **Cost tab — Phase B**  
   Missing: pricing source and expected accuracy.  
   Engineer would ask: are costs estimated from static pricing tables, provider usage APIs, or seeded demo pricing?

6. **Token usage capture — Phase A/B**  
   Missing: handling providers that do not return token counts consistently.  
   Engineer would ask: should we estimate tokens, store nulls, or normalize through a tokenizer?

7. **Near-real-time feed — Phase B**  
   Missing: acceptable staleness and empty/loading/error states.  
   Engineer would ask: what should the console show during ingestion lag or failure?

8. **Mock provider — Phase A**  
   Missing: determinism and realism expectations.  
   Engineer would ask: should mock responses be scripted, random, provider-shaped, or replayable deterministically?

## 3. Internal contradictions

1. **Time expectation conflict**  
   Quote A: “Time is unbounded; the team is solo.”  
   Quote B: “docker compose up... boots the entire stack... in roughly 60 seconds.”  
   Not a direct contradiction if “time” means build time, but the wording is ambiguous.

2. **Scope restraint vs. broad Phase B**  
   Quote A: “Coherence beats feature count.”  
   Quote B: “single `/console` surface with three tabs” including “charts,” “deep link,” “full trace-detail view,” “Replay,” “side-by-side,” “cost delta,” “latency delta,” and “diffed output.”  
   The PRD argues against scope inflation while committing to a large differentiator surface.

3. **Mock-default canonical demo vs. multi-real-provider ambition**  
   Quote A: “mock-default path is the canonical demo.”  
   Quote B: “Multi-provider support across OpenAI, Anthropic, and Gemini.”  
   Needs clarification on whether real-provider support must be demonstrable without keys.

## 4. Missing edge cases

1. What happens when the reviewer opens `/console` before any chat events exist?

2. What happens when one provider streams slowly but does not technically time out?

3. What happens when all configured providers fail?

4. What happens when a user refreshes during an active stream?

5. What happens when a conversation exceeds the context limit?

6. What happens when the same message is submitted twice?

7. What happens when ingestion succeeds but console aggregation lags or fails?

8. What happens when token usage is unavailable for a provider response?

9. What happens when replaying a failed, canceled, or timed-out inference?

10. What happens when mock data and real-provider data are mixed in the same Cost tab?

## 5. Scope creep risks

1. “OpenAI, Anthropic, and Gemini” plus failover is likely more than needed for a small-scale unless explicitly required.

2. “full trace-detail view” adds a second-order UI surface beyond the Traces table.

3. “charts” in Cost tab risks spending time on visualization polish instead of core ingestion correctness.

4. “Replay” with cross-provider diff, cost delta, latency delta, and side-by-side output is a major feature, not a small bonus.

5. “README... one-paragraph ‘here’s how I’d do it’ sketch” for every non-goal can bloat the project narrative.

6. “Observability-vocabulary check” is useful positioning, but reads like evaluation strategy rather than product requirement.

7. “screenshot the reviewer wants to send to their cofounder” is a good north star, but overused and somewhat subjective.

## 6. Length check

1. Not readable as a tight 1-2 page PRD in under 5 minutes. It is closer to a combined PRD, strategy memo, and architecture teaser.

2. Cut or move: implementation choices around Postgres, WebSockets, SDK wrapper, Next.js, context-token mechanics, and dashboard/Grafana discussion.

3. Compress: Problem, Success Criteria, and Open Questions. They repeat the same “single event spine / reviewer wow moment” message several times.

4. Keep: Phase A/Phase B split, mock-default demo path, Replay as differentiator, and explicit non-goals.

## 7. Quality score

1. **4/10**  
   Strong product instinct and coherent demo narrative, but it contains rejection-level format violations and too many HLD decisions for a product-only PRD.
