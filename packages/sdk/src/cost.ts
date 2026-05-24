// Cost calculator — static USD pricebook per (provider, model).
//
// Pricing snapshot as of 2026-05-24 (USD per 1,000,000 tokens, separated by
// prompt vs completion). Verify against each provider's pricing page before
// shipping a new model:
//   - OpenAI:    https://openai.com/api/pricing/
//   - Anthropic: https://www.anthropic.com/pricing
//   - Google:    https://ai.google.dev/pricing
//
// All amounts returned in **micro-USD** (integer) to avoid float drift —
// the projection consumer stores micro-USD ints in Postgres, so this keeps
// the wire format coherent end-to-end.
//
// Unknown (provider, model) returns { promptMicros: 0, completionMicros: 0 }
// rather than throwing; the operator console displays "—" for zero cost
// (see workers projection). This means a model we forget to price is
// visible-but-zero rather than silently dropped.

import type { ProviderName } from './providers/types';

/** USD per 1,000,000 tokens. */
interface ModelPrice {
  promptPerMillion: number;
  completionPerMillion: number;
}

/** Pricing snapshot as of 2026-05-24. Update with the snapshot date when bumping. */
const PRICEBOOK: Record<string, ModelPrice> = {
  // ---- OpenAI ----
  'openai:gpt-4o-mini': { promptPerMillion: 0.15, completionPerMillion: 0.6 },
  'openai:gpt-4o': { promptPerMillion: 2.5, completionPerMillion: 10.0 },
  'openai:gpt-4-turbo': { promptPerMillion: 10.0, completionPerMillion: 30.0 },
  'openai:gpt-3.5-turbo': { promptPerMillion: 0.5, completionPerMillion: 1.5 },

  // ---- Anthropic ----
  // Claude 4.x family (current generation).
  'anthropic:claude-haiku-4-5': { promptPerMillion: 1.0, completionPerMillion: 5.0 },
  'anthropic:claude-haiku-4-5-20251001': { promptPerMillion: 1.0, completionPerMillion: 5.0 },
  'anthropic:claude-sonnet-4-6': { promptPerMillion: 3.0, completionPerMillion: 15.0 },
  'anthropic:claude-opus-4-7': { promptPerMillion: 15.0, completionPerMillion: 75.0 },
  // Legacy 3.x family — kept for downgrade paths.
  'anthropic:claude-3-5-haiku-latest': { promptPerMillion: 0.8, completionPerMillion: 4.0 },
  'anthropic:claude-3-5-sonnet-latest': { promptPerMillion: 3.0, completionPerMillion: 15.0 },
  'anthropic:claude-3-opus-latest': { promptPerMillion: 15.0, completionPerMillion: 75.0 },
  'anthropic:claude-3-haiku-20240307': { promptPerMillion: 0.25, completionPerMillion: 1.25 },

  // ---- Google ----
  // Gemini 3.x is preview; Google hasn't published rates so price as zero
  // (operator console renders "—"). Update when GA pricing lands.
  'gemini:gemini-3-flash-preview': { promptPerMillion: 0, completionPerMillion: 0 },
  // Legacy 2.x / 1.5 family — kept for fallback paths.
  'gemini:gemini-2.0-flash-exp': { promptPerMillion: 0, completionPerMillion: 0 },
  'gemini:gemini-1.5-flash': { promptPerMillion: 0.075, completionPerMillion: 0.3 },
  'gemini:gemini-1.5-pro': { promptPerMillion: 1.25, completionPerMillion: 5.0 },

  // ---- Mock ----
  // Free — keeps dev runs at zero so the operator console treats them as "—".
  'mock:mock-1': { promptPerMillion: 0, completionPerMillion: 0 },
};

export interface CostBreakdown {
  promptMicros: number;
  completionMicros: number;
}

export function computeCost(
  provider: ProviderName,
  model: string,
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): CostBreakdown {
  const price = PRICEBOOK[`${provider}:${model}`];
  if (!price) {
    return { promptMicros: 0, completionMicros: 0 };
  }
  const promptMicros = toMicros(price.promptPerMillion, promptTokens ?? 0);
  const completionMicros = toMicros(price.completionPerMillion, completionTokens ?? 0);
  return { promptMicros, completionMicros };
}

/**
 * Convert (USD per 1M tokens, token count) → integer micro-USD.
 *
 * micro-USD = USD * 1e6, so:
 *   micros = pricePerMillion * tokens
 * (pricePerMillion is already "USD per 1e6 tokens" → multiplying by tokens
 *  gives USD * 1e-6 * tokens ... but micro-USD = USD * 1e6, so the algebra
 *  collapses to a simple `pricePerMillion * tokens` for the micro-USD value
 *  of a single-token block. Hand-verify with an example: gpt-4o-mini at
 *  $0.15 per 1M prompt tokens, 1M tokens → $0.15 → 150000 micro-USD. The
 *  formula gives 0.15 * 1_000_000 = 150000. Checks out.)
 */
function toMicros(pricePerMillion: number, tokens: number): number {
  if (tokens <= 0) return 0;
  return Math.round(pricePerMillion * tokens);
}

/** Exposed for tests to assert the pricebook contains an expected entry. */
export function priceFor(provider: ProviderName, model: string): ModelPrice | undefined {
  return PRICEBOOK[`${provider}:${model}`];
}
