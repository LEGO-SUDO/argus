// Shared token-heuristic helpers.
//
// chat-context-and-ux-polish LLD Tasks 48/49/51 + Codex-vagueness fix:
//
// Both `ContextMeterService` (apps/api/src/chat) and the conversations
// controller (apps/api/src/conversations) need to count tokens against a
// configured default budget. Keeping the helper in `apps/api/src/common/`
// prevents either layer from depending on the other (an import from
// `conversations → chat` would invert layering; chat → conversations would
// pull domain logic into a peer).
//
// Heuristic:
//   - Token estimate: ~4 chars per token (industry rule-of-thumb for English
//     text + most BPE tokenizers; off by maybe 30% for code-heavy content
//     but acceptable for a UI indicator and meter readout).
//   - The configured default budget reads `CONTEXT_TOKEN_BUDGET` env;
//     defaults to 10000 (the PRD: "default context budget for a
//     conversation is 10,000 tokens"). The pre-backbone default of 6000 is
//     intentionally bumped — the frontend's context meter assumes 10000
//     and visibly clamps low under the old default.

const DEFAULT_TOKEN_BUDGET = 10_000;
const CHARS_PER_TOKEN = 4;

/**
 * Read the configured default context budget from env. Returns
 * `DEFAULT_TOKEN_BUDGET` (10000) when the var is unset or unparseable so a
 * deployment that forgets the env doesn't silently meter against 0.
 */
export function defaultContextBudget(): number {
  const raw = process.env.CONTEXT_TOKEN_BUDGET;
  if (!raw) return DEFAULT_TOKEN_BUDGET;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOKEN_BUDGET;
  return Math.floor(n);
}

/**
 * Estimate the token count for a piece of content using the 4-chars-per-token
 * rule of thumb. Always returns a non-negative integer; the ceiling means we
 * over-count slightly rather than under-count and overflow the model's
 * actual context window downstream.
 */
export function estimateTokens(content: string): number {
  if (content.length === 0) return 0;
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}
