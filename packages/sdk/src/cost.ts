// Cost calculator + catalog accessors — static pricebook per (provider, model).
//
// Pricing snapshot as of 2026-05-24 (USD per 1,000,000 tokens, separated by
// prompt vs completion). Verify against each provider's pricing page before
// shipping a new model:
//   - OpenAI:    https://openai.com/api/pricing/
//   - Anthropic: https://www.anthropic.com/pricing
//   - Google:    https://ai.google.dev/pricing
//
// Context windows: integer token caps sourced from public provider pages.
// Each pricebook entry carries `contextWindow` so the picker can render the
// number and the gateway can compute an effective budget bounded by the
// pinned model (chat-context-and-ux-polish LLD Tasks 15/16/17/18, HLD D4).
//
// All cost amounts returned in **micro-USD** (integer) to avoid float drift —
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

/** Pricebook entry with the context window cap layered on. */
interface CatalogEntry extends ModelPrice {
  /** Integer token cap for this model. */
  contextWindow: number;
}

/** Pricing snapshot as of 2026-05-24. Update with the snapshot date when bumping. */
const PRICEBOOK: Record<string, CatalogEntry> = {
  // ---- OpenAI ----
  // gpt-4o family: 128k. gpt-4-turbo: 128k. gpt-3.5-turbo: 16k (per OpenAI docs).
  'openai:gpt-4o-mini': { promptPerMillion: 0.15, completionPerMillion: 0.6, contextWindow: 128_000 },
  'openai:gpt-4o': { promptPerMillion: 2.5, completionPerMillion: 10.0, contextWindow: 128_000 },
  'openai:gpt-4-turbo': { promptPerMillion: 10.0, completionPerMillion: 30.0, contextWindow: 128_000 },
  'openai:gpt-3.5-turbo': { promptPerMillion: 0.5, completionPerMillion: 1.5, contextWindow: 16_000 },

  // ---- Anthropic ----
  // Claude 4.x family + 3.5 family + 3-haiku-20240307: 200k window across the board.
  'anthropic:claude-haiku-4-5': { promptPerMillion: 1.0, completionPerMillion: 5.0, contextWindow: 200_000 },
  'anthropic:claude-haiku-4-5-20251001': { promptPerMillion: 1.0, completionPerMillion: 5.0, contextWindow: 200_000 },
  'anthropic:claude-sonnet-4-6': { promptPerMillion: 3.0, completionPerMillion: 15.0, contextWindow: 200_000 },
  'anthropic:claude-opus-4-7': { promptPerMillion: 15.0, completionPerMillion: 75.0, contextWindow: 200_000 },
  // Legacy 3.x family — kept for downgrade paths.
  'anthropic:claude-3-5-haiku-latest': { promptPerMillion: 0.8, completionPerMillion: 4.0, contextWindow: 200_000 },
  'anthropic:claude-3-5-sonnet-latest': { promptPerMillion: 3.0, completionPerMillion: 15.0, contextWindow: 200_000 },
  'anthropic:claude-3-opus-latest': { promptPerMillion: 15.0, completionPerMillion: 75.0, contextWindow: 200_000 },
  'anthropic:claude-3-haiku-20240307': { promptPerMillion: 0.25, completionPerMillion: 1.25, contextWindow: 200_000 },

  // ---- Google ----
  // Gemini 2.5 family (current GA). Rates are approximate published list
  // prices (USD per million tokens) and may drift — adjust if Google revises.
  // Flash/Flash-Lite carry a 1M-token window; Pro extends to 2M.
  'gemini:gemini-2.5-flash': { promptPerMillion: 0.3, completionPerMillion: 2.5, contextWindow: 1_048_576 },
  'gemini:gemini-2.5-pro': { promptPerMillion: 1.25, completionPerMillion: 10.0, contextWindow: 2_097_152 },
  'gemini:gemini-2.5-flash-lite': { promptPerMillion: 0.1, completionPerMillion: 0.4, contextWindow: 1_048_576 },

  // ---- Mock ----
  // Free + small window — keeps dev runs visible. The 8k cap lets the
  // ContextMeter "near full" UX trigger on a chat of modest length without
  // requiring callers to override the env budget.
  'mock:mock-1': { promptPerMillion: 0, completionPerMillion: 0, contextWindow: 8192 },
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

/**
 * Exposed for tests to assert the pricebook contains an expected entry.
 *
 * KEEP this byte-identical to its pre-backbone shape (no contextWindow field)
 * — Phase A callers (cost.test.ts at file-load time) assert exact equality
 * against `{ promptPerMillion, completionPerMillion }`. The new accessors
 * below expose the contextWindow.
 */
export function priceFor(provider: ProviderName, model: string): ModelPrice | undefined {
  const entry = PRICEBOOK[`${provider}:${model}`];
  if (!entry) return undefined;
  return {
    promptPerMillion: entry.promptPerMillion,
    completionPerMillion: entry.completionPerMillion,
  };
}

// ---------------------------------------------------------------------------
// chat-context-and-ux-polish LLD Tasks 15-18 — catalog + budget accessors.
// ---------------------------------------------------------------------------

/** Combined accessor: cost + context window for a (provider, model) pair. */
export interface CatalogEntryReadout {
  promptPerMillion: number;
  completionPerMillion: number;
  contextWindow: number;
}

/**
 * Return combined cost + context window for a known (provider, model) pair,
 * or null when the pair is not in the pricebook. The picker uses this to
 * decorate model entries with both pricing and a numeric window cap.
 */
export function getCatalogEntry(
  provider: ProviderName,
  model: string,
): CatalogEntryReadout | null {
  const entry = PRICEBOOK[`${provider}:${model}`];
  if (!entry) return null;
  return {
    promptPerMillion: entry.promptPerMillion,
    completionPerMillion: entry.completionPerMillion,
    contextWindow: entry.contextWindow,
  };
}

/** Pin descriptor — both fields required when present (caller's coupling rule). */
export interface PinDescriptor {
  provider: ProviderName | string;
  model: string;
}

/**
 * Compute the effective context budget for a turn given the configured
 * default and an optional pin.
 *
 * Rules (HLD D4 + LLD Task 18):
 *   - No pin → return the configured default unchanged.
 *   - Pinned to a known model → return min(default, model's contextWindow).
 *   - Pinned to an unknown (provider, model) → return the configured default
 *     (do not throw; the picker may transiently lag the catalog and we'd
 *     rather over-budget by the default than fail the request).
 */
export function getEffectiveBudget(
  configuredDefault: number,
  pin?: PinDescriptor,
): number {
  if (!pin) return configuredDefault;
  const entry = getCatalogEntry(pin.provider as ProviderName, pin.model);
  if (!entry) return configuredDefault;
  return Math.min(configuredDefault, entry.contextWindow);
}
