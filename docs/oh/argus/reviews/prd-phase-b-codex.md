## 1. Format violations

1. `"With API keys configured in .env"` — file path/config detail. Move to HLD
   or README.

2. `"add key in .env, or replay against Mock"` — file path/config detail. Move
   to HLD or README.

3. `"The submission ships .env.example with key slots"` — file path/config
   detail. Move to HLD or README.

4. `"all read from the same OTel event spine Phase A produces"` — architecture
   decision. Move to HLD.

5. `"Clicking any row opens a full trace-detail view in Jaeger (deep link)"` —
   specific observability implementation/tool choice. Move to HLD unless Jaeger
   is explicitly a product requirement.

6. `"All three tabs are listeners on the same inference data Phase A persists"`
   — architecture/data-flow detail. Move to HLD.

7. `"Phase B introduces no new ingestion paths, no new persistence layers beyond what Phase A's schema already accommodates"`
   — architecture constraint. Move to HLD.

8. `"(replay-run tagging is a new column on inferences; sample-seed flagging is the same column)"`
   — schema detail. Move to LLD.

9. `"pause the projection consumer"` — implementation/test mechanism. Move to
   LLD/test plan.

10. ``"`docker compose up` remains the submission surface"`` — delivery/runtime
    command. Move to README.

11. `"routes in the same Next.js app"` — framework/architecture decision. Move
    to HLD.

## 2. Underspecified requirements

1. **Real-provider integration:** Missing provider priority/order, retry policy,
   and what counts as “pre-first-token failure.” Engineer would ask: which
   failures trigger failover, in what order, and how many attempts? ans: 3
   attempts, all failures trigger Failover no need to overcomplicate

2. **Provider/model selection:** Missing default provider/model behavior.
   Engineer would ask: who chooses the initial provider/model, and can the
   reviewer override it in `/chat`? ans: there will an option in provider
   selector called auto, which decides based on question type which model to
   use, question related to coding -> anthropic, related to research or web
   facts -> gemini rest all codex

3. **Failover visibility:** “attempt chain expandable” is clear conceptually,
   but missing fields. Engineer would ask: what metadata must be shown per
   attempt: error class, message, duration, token usage, timestamp? ans: yes all
   the metrics that help me judge, user message metadata, error log, status,
   token burnt, model, timestamp

4. **Traces filters:** Missing combined-filter semantics. Engineer would ask:
   are provider/model/status/conversation filters ANDed, and does search apply
   within filtered results? ans: is yes we need provider level filter, model
   level
5. **Time windows:** “24h / 7d / all-time” appears across Traces and Cost, but
   Replay behavior is unclear. Engineer would ask: does Replay candidate
   selection respect the active Traces time window? ans: yes
6. **Cost calculation:** Missing rounding rules beyond row display. Engineer
   would ask: are totals calculated from exact raw costs then rounded, or summed
   from rounded row costs? ans: added then final is rounded when displaying on
   ui, at storage level we need to keep exact amounts
7. **Pricing snapshot:** Missing versioning/update behavior. Engineer would ask:
   what happens when a model exists in traces but not in pricing, or when
   provider pricing changes after submission? ans: we need to consider fixed
   prices for provider rn not need for dynamic setup
8. **Replay input fidelity:** “exact original input” is underspecified. Engineer
   would ask: does this include system prompt, tools, temperature, max tokens,
   conversation history, attachments, and provider-specific params? ans: decide
   for yourself
9. **Replay diff:** Missing handling for failed or empty outputs. Engineer would
   ask: what does the diff show when original failed, replay failed, or either
   side has no output? ans: need to handle gracefully, no need to show random
   stuff here, need to handle show appropriate error message
10. **Live badge:** Missing definition of “ingestion is current.” Engineer would
    ask: current relative to what clock/source, and what counts as ingestion
    failure versus no new traffic?

11. **Sample data:** Missing ownership/scope. Engineer would ask: is sample data
    per user/session, shared globally, or isolated to the seeded demo user? ans:
    both per user as well as per session
12. **Clear sample data:** Missing boundary. Engineer would ask: does “clear”
    remove only seeded synthetic data, or all inferences including real reviewer
    chats? ans: including reviewer chats

## 3. Internal contradictions

1. **Throughput is both covered and unresolved.** Success Criteria says:
   `"JD-vocabulary check: in /console the reviewer can point at concrete surfaces for Latency, Throughput, and Errors ... per-hour aggregation on the Cost sparkline cover all three."`
   Open Questions says:
   `"Throughput ... does not have an obvious home in any of the three tabs as currently scoped."`
   ans: yes this valid no need for open question
2. **No new persistence/schema versus new column.** Constraints says:
   `"Phase B introduces no new ingestion paths, no new persistence layers beyond what Phase A's schema already accommodates"`
   Same sentence says:
   `"(replay-run tagging is a new column on inferences; sample-seed flagging is the same column)."`
   ans: we can add if some data is required for new ingestion paths
3. **Replay can start from failed/timed-out inferences, but detail assumes
   successful output/cost.** Replay tab says:
   `"successful, failed, or timed-out"` Same section says:
   `"The detail view shows original metadata up top ... cost, full input, full output"`
   Failed/timed-out inferences may not have completion tokens, cost, or full
   output. ans: need to capture with what we can and if there's an error we
   surface that

## 4. Missing edge cases

1. What happens when all configured real providers fail before first token? ans:
   attempt next provider

2. What happens when a provider fails after streaming has already started? ans:
   need to show error message with an option to retry
3. What happens when a replay target is configured but currently unavailable or
   rate-limited? ans: again need to handle
4. What happens when provider responses are blocked by safety filters or return
   refusal-style output? ans: need to surface to user then this response was
   blocked
5. What happens when token counts are missing, provider-estimated, or
   unavailable? ans: unavailable and our observability should capture reason for
   missing
6. What happens when a model is present in traces but absent from the pricing
   snapshot? ans: need to show error
7. What happens when a conversation title is blank, duplicated, deleted, or
   later renamed? ans: id remains unchanged and which is treated as identifier
   for conversation not name or other, and if conversation is deleted metadata
   still remains
8. What happens when replaying a failed inference whose original input was
   partially captured? ans: no need to handle for now
9. What happens when the selected inference contains very long input/output that
   would overwhelm the side-by-side view? ans: need an expanded view option then
10. What happens when a reviewer opens `/console` in one tab and generates chat
    in another? ans: need to see live logs in console
11. What happens when sample data and real data coexist? ans: real data is
    preferred
12. What happens when “clear sample data” is clicked after replay runs were
    generated from sample traces? ans: no need to handle
13. What happens when live updates lag but the user has active filters hiding
    the new inference? ans: no need to handle
14. What happens when cost is below $0.005 and rounds to `$0.00`? ans: will
    never round in backend and db and on ui we show low amounts as < $0.01
15. What happens when canceled inferences have partial tokens/cost from the
    provider? ans: need to show them with error that full data not captured

## 5. Scope creep risks

1. Three tabs plus real providers plus failover plus replay plus live status is
   large for one phase.

2. Word-level highlighted diff is polish-heavy and can become a mini diff
   engine.

3. Jaeger deep links add external-tool integration that may distract from the
   product surface.

4. “Generate sample inferences” plus clearable seeded data adds a second data
   lifecycle.

5. Live badge with lag/error/retry states adds operational monitoring behavior
   beyond a basic dashboard.

6. Provider/model matrix switching in Replay expands the surface beyond “replay
   against another provider.”

7. Sparkline plus grouping plus drilldowns plus time windows risks turning Cost
   into a full analytics product.

8. “One screenshot worth sending to a cofounder” is subjective and may invite
   visual polish churn.

## 6. Length check

1. Not readable in under 5 minutes. It is closer to an HLD/product hybrid than a
   1-2 page PRD.

2. Cut or move: OTel spine, Jaeger, schema column, Next.js, `.env`,
   `.env.example`, projection consumer, Docker command.

3. Compress Problem and Target Users by half; they repeat evaluation framing
   more than requirements.

4. Move Open Questions defaults into the relevant requirement sections once
   decided. Keeping both creates ambiguity.

5. Split detailed UI behavior into product bullets and move
   implementation/tooling detail to HLD/LLD.

## 7. Quality score

1. **6/10**. Strong product intent and demo flow, but it contains
   rejection-level implementation details, unresolved throughput ambiguity, and
   several edge cases that engineering would need clarified before build.
