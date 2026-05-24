// ContextMeter — token-usage indicator for the active conversation (LLD
// Block F, Tasks 92-95).
//
// Presentational only: takes the tokensUsed/tokensBudget of the last
// completed assistant turn and renders the PRD fraction "8.2k / 10k tokens".
// Returns null (no layout box) when the inputs are incomplete so the chat
// surface can omit it without a layout shift:
//   - budget is 0 (model context window unknown / not configured)
//   - tokensUsed is null or undefined (no completed turn yet)
//   - tokensBudget is null or undefined
'use client';

type ContextMeterProps = {
  tokensUsed: number | null | undefined;
  tokensBudget: number | null | undefined;
};

export function ContextMeter({ tokensUsed, tokensBudget }: ContextMeterProps) {
  // Guards (Task 94-95). Note: `tokensBudget === 0` is treated as "unknown"
  // and suppresses the meter (a zero budget can't produce a meaningful
  // fraction and would render "X / 0 tokens").
  if (tokensUsed === null || tokensUsed === undefined) return null;
  if (tokensBudget === null || tokensBudget === undefined) return null;
  if (tokensBudget === 0) return null;

  // Use the SAME formatted values in the accessible label as the visible text
  // (design review FIX 6) so a screen reader hears "8.2k of 10k", matching the
  // "8.2k / 10k tokens" on screen — not the raw integers "8200 of 10000".
  const usedLabel = formatTokens(tokensUsed);
  const budgetLabel = formatTokens(tokensBudget);

  return (
    <div
      data-testid="context-meter"
      className="mono text-[11.5px] text-chat-ink-3"
      aria-label={`${usedLabel} of ${budgetLabel} context tokens used`}
    >
      {usedLabel} / {budgetLabel} tokens
    </div>
  );
}

/**
 * Format a token count in the PRD "8.2k" style for values >= 1000; below
 * 1000 the raw integer is shown. One decimal place for the k-suffix form,
 * trimmed of a trailing ".0" (so 10000 → "10k", not "10.0k").
 */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // toFixed(1) then strip a trailing ".0" for round thousands.
  const s = k.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}k`;
}
