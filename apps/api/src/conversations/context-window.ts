// Context-window heuristic — Phase A approximation of the SDK's context
// builder. The real SDK (packages/sdk, Phase B) owns the canonical
// `buildContext(messages, maxTokens)` function; until it lands we mirror its
// drop-oldest-first behavior here so the conversations REST `omittedCount`
// field (frontend-web Task 42 "N earlier messages omitted") is correct on
// first paint.
//
// chat-context-and-ux-polish backbone (LLD Tasks 49/51):
//   - The 4-chars-per-token estimator and the default-budget reader moved
//     to `apps/api/src/common/token-heuristic.ts`. This module now reads
//     from there so `ContextMeterService` (chat module) and the
//     conversations controller share the same primitive without either
//     module importing the other.
//   - PRD default bumped 6000 → 10000 (LLD Task 51); fixture tests in
//     this directory updated accordingly.
//
// Heuristic:
//   - Token estimate: `estimateTokens` from common (~4 chars per token).
//   - Drop oldest-first until the running sum fits in
//     `defaultContextBudget()` (env CONTEXT_TOKEN_BUDGET, default 10000).
//   - Always keep the most-recent message even if it alone exceeds the
//     budget (otherwise the user's just-sent prompt would be dropped —
//     non-sensical; the SDK will truncate that case via input handling).
//
// Phase B refinement: swap this for the SDK's exact token counter
// (provider-specific) so the indicator matches what the model actually
// receives. The shape of this function (rows in, count out) is stable.
import type { MessageRow } from './messages.repository';
import { defaultContextBudget, estimateTokens } from '../common/token-heuristic';

/**
 * Return the number of leading (oldest) messages that would be dropped from
 * the SDK's context window. Returns 0 when everything fits.
 *
 * `rows` MUST be in chronological order (oldest first), as returned by
 * MessagesRepository.listForConversation.
 */
export function computeOmittedCount(rows: ReadonlyArray<Pick<MessageRow, 'content'>>): number {
  if (rows.length <= 1) return 0;
  const budget = defaultContextBudget();
  // Walk from newest backwards, accumulating tokens. Stop when adding the
  // next-older message would exceed the budget — everything older is
  // "omitted".
  let runningTokens = 0;
  let keepCount = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rows[i]!.content);
    if (keepCount === 0) {
      // Always keep the most-recent message even if it alone exceeds budget.
      runningTokens = cost;
      keepCount = 1;
      continue;
    }
    if (runningTokens + cost > budget) break;
    runningTokens += cost;
    keepCount += 1;
  }
  return rows.length - keepCount;
}
