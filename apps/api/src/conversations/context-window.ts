// Context-window heuristic — Phase A approximation of the SDK's context
// builder. The real SDK (packages/sdk, Phase B) owns the canonical
// `buildContext(messages, maxTokens)` function; until it lands we mirror its
// drop-oldest-first behavior here so the conversations REST `omittedCount`
// field (frontend-web Task 42 "N earlier messages omitted") is correct on
// first paint.
//
// Heuristic:
//   - Token estimate: ~4 chars per token (industry rule-of-thumb for
//     English text + most BPE tokenizers; off by maybe 30% for code-heavy
//     content but acceptable for a UI indicator).
//   - Drop oldest-first until the running sum fits in CONTEXT_TOKEN_BUDGET
//     (env, default 6000 — matches brief.md "last N turns, hard-capped at
//     ~6k tokens, configurable via env").
//   - Always keep the most-recent message even if it alone exceeds the
//     budget (otherwise the user's just-sent prompt would be dropped —
//     non-sensical; the SDK will truncate that case via input handling).
//
// Phase B refinement: swap this for the SDK's exact token counter
// (provider-specific) so the indicator matches what the model actually
// receives. The shape of this function (rows in, count out) is stable.
import type { MessageRow } from './messages.repository';

const DEFAULT_TOKEN_BUDGET = 6000;
const CHARS_PER_TOKEN = 4;

function tokenBudget(): number {
  const raw = process.env.CONTEXT_TOKEN_BUDGET;
  if (!raw) return DEFAULT_TOKEN_BUDGET;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOKEN_BUDGET;
  return Math.floor(n);
}

function estimateTokens(content: string): number {
  // Ceiling — better to slightly over-count and trim more than under-count
  // and overflow the model's actual context window downstream.
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

/**
 * Return the number of leading (oldest) messages that would be dropped from
 * the SDK's context window. Returns 0 when everything fits.
 *
 * `rows` MUST be in chronological order (oldest first), as returned by
 * MessagesRepository.listForConversation.
 */
export function computeOmittedCount(rows: ReadonlyArray<Pick<MessageRow, 'content'>>): number {
  if (rows.length <= 1) return 0;
  const budget = tokenBudget();
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
