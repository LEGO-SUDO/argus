## 1. Format Violations

1. `/console`, `/chat` appear throughout. These are route paths, but product-facing surface names are acceptable here; not rejection-level unless the PRD is expected to avoid all URL-like paths. Keep or rename to “console” / “chat surface.”

2. No code blocks, type/interface definitions, API specs, status codes, file paths, function names, FR/NFR numbering, architecture decisions, test-plan structure, or implementation-only performance budgets found.

## 2. Underspecified Requirements

1. **Real-provider integration**: “Auto routes by question type” is underspecified. What exactly counts as “coding-related,” “research,” or “web-fact”? Engineer would ask for deterministic routing rules or accepted ambiguity.

2. **Real-provider integration**: “Without configured keys, the Mock provider remains the default” conflicts with four visible selector options. Should unavailable real providers be hidden, disabled, or selectable-but-failing?

3. **Failover policy**: “next provider” is undefined. Engineer would ask for provider order, whether Mock participates, and whether user-selected providers can fail over to non-selected providers.

4. **Failover policy**: “Any provider failure” is broad. Clarify whether safety refusals, validation errors, rate limits, auth failures, timeouts, and user cancellation all trigger failover.

5. **Traces tab**: “conversation reference” is vague. Is it ID, title, both, deleted label, clickable link, or preview?

6. **Throughput strip**: “turns/hour, tokens/hour, and error rate” needs denominator definitions. Are replay/sample/canceled/failed attempts included? Is throughput based on turns, attempts, or successful completions?

7. **Filters and search**: “free-text search box applies within the filtered set” does not define searchable fields. Engineer would ask whether it searches input, output, errors, provider, model, conversation title, or IDs.

8. **Cost tab**: “grouped by conversation by default” needs behavior for deleted conversations, sample data, replay data, missing pricing, and mixed priced/unpriced rows.

9. **Cost tab**: “Mock-provider rows are visually distinct and excluded from Cost totals by default” needs mock pricing behavior. Are mock costs zero, synthetic, or priced for validation?

10. **Replay tab**: “picks a past inference from Traces” needs selection UX. Is Replay launched from row action, checkbox, detail drawer, or tab state?

11. **Replay tab**: “provider and model from independent pickers” needs valid-combination behavior. What happens if user picks Anthropic provider with an OpenAI model?

12. **Replay tab**: “word-level highlighted diff” needs product tolerance. How should whitespace, markdown, code blocks, tables, and streaming partials be represented?

13. **Live update behavior**: “despite the pipeline running” is not product-observable. What user-visible condition determines ingestion failure?

14. **Sample data**: “isolated per user and per session” needs definition of session lifetime. Browser tab, auth session, device, cookie session, or server session?

15. **Clear control**: “wipes all inferences for the user” needs confirmation UX and reversibility. Engineer would ask whether this also clears conversations or only inference metadata.

## 3. Internal Contradictions

1. **Replay candidate eligibility conflict**
   - Replay tab: “The reviewer picks a past inference from Traces — successful, failed, or timed-out”
   - Replay tab: “Canceled inferences are excluded”
   - Failure handling: “Original was canceled — no output to compare”
   If canceled originals are excluded, the Replay pane should not need an original-canceled state.

2. **Live badge no-traffic conflict**
   - Live update behavior: “Live (green) when the lag between the newest persisted inference and current wall clock is under 5 seconds, or when there is no traffic.”
   - Live update behavior: “Ingestion failure… when no inference rows have been committed in 30 seconds despite the pipeline running.”
   “No traffic” and “pipeline running with no committed rows” need a product-visible distinction.

3. **Cost totals vs canceled partial tokens**
   - Replay Persistence: “Replay runs… are excluded from Cost totals by default.”
   - Cross-cutting: “Canceled inferences with partial tokens… still contribute to Cost since the tokens consumed are real spend.”
   If a replay run is canceled with partial tokens, which exclusion wins?

4. **Mock keyless path vs success criteria**
   - Real-provider integration: “Without configured keys, the Mock provider… remains the default”
   - Success Criteria: “With one configured provider deliberately broken, the next turn fails over…”
   This is acceptable only if clearly marked “requires real keys,” but that specific criterion is not labeled inline.

## 4. Missing Edge Cases

1. What happens when Auto selects a provider with no configured key but another real provider is configured?

2. What happens when all real providers are unavailable but Mock is available: fail to user, or answer with Mock?

3. What happens when a provider succeeds but returns no token counts?

4. What happens when token counts arrive after the trace row is first displayed?

5. What happens when pricing is missing for one model inside a grouped Cost row with other priced models?

6. What happens when replaying an inference whose original conversation was deleted?

7. What happens when replaying a failed inference with no captured input or incomplete history?

8. What happens when sample and real data share the same conversation display name?

9. What happens when Clear is clicked while a chat turn or replay run is in flight?

10. What happens when multiple browser tabs generate sample data for the same user/session?

11. What happens when the reviewer changes the Traces time window while a Replay detail view is open?

12. What happens when a replay target model becomes unavailable after being selected?

## 5. Scope Creep Risks

1. Four-provider real integration plus Auto routing is a large expansion beyond a control-plane demo.

2. Failover with attempt-chain observability is valuable but materially increases backend and UX complexity.

3. Word-level highlighted diff is likely gold-plating for a 3-minute reviewer demo.

4. Live badge state machine with amber/error/retry is more operational-dashboard than candidate-demo unless already supported.

5. Sample-data lifecycle with per-user and per-session isolation, real/sample sorting, toggle, and full clear semantics is broad.

6. Cost tab sparkline, grouping, regrouping, drilldown, exact micro-USD math, missing-pricing treatment, and mock exclusion is a lot for one tab.

7. Replay provider/model independent pickers plus reset, disabled states, original-provider rerun, side-by-side expansion, and persistence is close to a full feature area.

8. Safety-filter/refusal as distinct status may require provider-specific normalization not otherwise scoped.

## 6. Length Check

1. Not readable in under 5 minutes for most engineers. It is closer to a compact full feature spec than a 1-2 page PRD.

2. Cut or move detail on exact Cost math, live badge thresholds, sample-data lifecycle, word-level diff mechanics, provider failover attempt fields, and Replay pane behavior into HLD/LLD.

3. Keep the PRD focused on: why `/console` exists, the three tabs, core reviewer journeys, must-have acceptance criteria, and explicit non-goals.

## 7. Quality Score

7
