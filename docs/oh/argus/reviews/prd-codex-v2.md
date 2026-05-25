## 1. Format violations

1. `"A working chatbot at \`/chat\`."` — API/product route detail; move to HLD or rephrase as “chat surface.”
2. `"one \`/console\` surface with three tabs"` — route detail; move to HLD or rephrase as “operator console.”
3. `"Empty \`/console\`"` — route detail; move to HLD or rephrase as “empty console.”
4. `"try sending a message in /chat"` — route detail; move to HLD or rephrase as “try sending a chat message.”
5. `”docker compose up”` — implementation/deployment command. Borderline acceptable as the primary demo surface, but should live in README/HLD; PRD can say “single-command local startup.”
6. `"demo@argus.local / demo"` — credential detail. Move to README/HLD; PRD should require a seeded demo account, not specify exact secrets.
7. `"static pricing table maintained in the repository"` — implementation/storage decision. Move to HLD.
8. `"event stream"` / `"event-based architecture"` — acceptable as product framing only if the small-scale requires it; otherwise architecture vocabulary should be HLD.

## 2. Underspecified requirements

1. **Authenticated identity, Phase A:** Missing expected sign-up/sign-in behavior after refresh, failed login, duplicate email, logout. Engineer would ask what auth states must be visible in the demo.
2. **Conversation persistence, Phase A:** “conversation persists across reloads” does not define whether partial, failed, canceled, and retried turns appear in the same thread or as separate attempts.
3. **Limited recent conversation history, Phase A:** “specific mechanics deferred to HLD” leaves product behavior unclear. Engineer would ask what the reviewer should see when older context is omitted.
4. **Provider failover, Phase A:** Missing provider ordering and whether unavailable/unconfigured providers appear in UI. Engineer would ask how the active provider is selected.
5. **Mock provider, Phase A:** “real-looking streamed response” is subjective. Engineer would ask what minimum quality makes the mock acceptable.
6. **Token usage, Phase A:** Missing how token counts are estimated for mock and streaming/canceled responses. Engineer would ask whether approximate counts are acceptable.
7. **Cancel UX, Phase A:** Missing whether cancel stops billing display immediately, whether partial output remains visible in chat, and whether retry uses the same or new turn.
8. **Traces detail view, Phase B:** “deep link to a full trace-detail view” does not define required fields. Engineer would ask what details are mandatory.
9. **Cost tab, Phase B:** Missing currency, rounding, time window defaults, and whether prompt/completion costs are separated.
10. **Replay tab, Phase B:** Missing replay eligibility rules besides canceled exclusion. Engineer would ask whether failed, interrupted, mock, and partially completed turns can replay.
11. **Output diff, Phase B:** Missing expected diff granularity. Engineer would ask whether line-level, word-level, or semantic comparison is required.
12. **Near-real-time staleness:** Missing what “behind by Ns” means from a user perspective. Engineer would ask whether this is ingestion lag, last event age, or polling age.
13. **README architecture quality:** “Stripe sniff test” is subjective. Engineer would ask what concrete sections or diagrams are required.

## 3. Internal contradictions

1. **Product-only vs architecture-heavy framing:**  
   `"specific mechanics deferred to HLD"` acknowledges HLD separation, but `"event stream"`, `"event spine"`, and `"event-based architecture"` repeatedly prescribe architecture. Move the latter to HLD or keep only as product-visible narrative.
2. **Scope discipline vs breadth:**  
   `"Coherence beats feature count."` conflicts with `"multi-provider support across OpenAI, Anthropic, and Gemini, with automatic failover"` plus auth, streaming, ingestion, dashboards, replay, cost, traces, cancel/list/resume. This may still be intentional, but it is a scope tension.
3. **Default keyless demo vs all-provider requirement:**  
   `"The mock provider is the canonical demo path that works keyless"` conflicts with `"multi-provider support across OpenAI, Anthropic, and Gemini"` unless real providers are explicitly optional for acceptance.
4. **Build effort unbounded vs small-scale pragmatism:**  
   `"Build effort is unbounded — polish over speed"` conflicts with the small-scale context judging `"velocity, pragmatism"`. This risks pushing the engineering plan past reasonable project scope.

## 4. Missing edge cases

1. What happens when sign-up succeeds but no conversations exist?
2. What happens when the seeded demo user already exists with prior data?
3. What happens when two browser tabs stream in the same conversation?
4. What happens when a user sends another message while a response is streaming?
5. What happens when the user cancels immediately before the first token?
6. What happens when the provider fails after producing metadata but before output?
7. What happens when ingestion succeeds but cost enrichment fails?
8. What happens when cost pricing is missing for a provider/model?
9. What happens when replay target equals original provider?
10. What happens when replay output is identical, empty, or errors?
11. What happens when an inference has very large input/output previews?
12. What happens when the console is opened by a different authenticated user?
13. What happens when history omission changes replay input versus original input?
14. What happens when a conversation is deleted or archived, if deletion is possible?
15. What happens when the mock and real providers return different status/token semantics?

## 5. Scope creep risks

1. Three real providers plus mock plus automatic failover is high scope for a small-scale.
2. Auth with sign-up, seeded demo user, scoped conversations, and persistence may distract from inference logging.
3. Replay with side-by-side diff, cost delta, latency delta, provider fallback, and unavailable-provider UX is a large feature.
4. Near-real-time lag indicators and ingestion failure states add observability polish beyond the core requirement.
5. Full trace-detail view is not defined and could expand quickly.
6. Cost over time, by provider, model, and conversation may become a mini-analytics product.
7. README “Would Do Next” sketches for evals, resume, auth hardening, PII, hosting, Kubernetes may bloat the project narrative.
8. “Senior-level quality” and “Stripe sniff test” are vague quality escalators that invite overbuilding.

## 6. Length check

1. No. It is readable, but not under 5 minutes as a crisp 1-2 page PRD.
2. Cut or move route names, credentials, Docker command details, pricing-table implementation, HLD deferrals, Observability-vocabulary checklist, and most “Would Do Next” detail.
3. Collapse Phase A/B exit bars and Success Criteria to remove repetition.
4. Move open implementation choices to HLD: provider ordering, event architecture, pricing source, Grafana decision, stream identifiers.

## 7. Quality score

1. **6/10** — strong product spine and demo path, but too long, somewhat architecture-heavy, and carrying major scope risk for a small-scale.
