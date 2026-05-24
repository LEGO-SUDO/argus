// Provider availability — the model catalog the four-option provider selector
// renders, so the frontend never hardcodes a catalog.
//
// NOTE (hand-off): the @argus/sdk public surface (PR #4) exports only `chat` +
// types — it does NOT expose its internal pricebook or a model-list / snapshot
// surface, and packages/sdk is out of this pane's ownership. So this catalog
// mirrors the SDK pricing snapshot (cost.ts, dated 2026-05-24) here. When the
// SDK adds a `pricingSnapshot()` / `listModels()` export, this should source
// from it directly (single source of truth) — tracked as a follow-up.
import type { ProviderAvailabilityResponse, ProviderCatalog } from '@argus/contracts';

export const PRICING_SNAPSHOT_DATE = '2026-05-24';

interface ModelPrice {
  model: string;
  promptPerMillionUsd: number;
  completionPerMillionUsd: number;
}

const CATALOG: Record<string, ModelPrice[]> = {
  openai: [
    { model: 'gpt-4o-mini', promptPerMillionUsd: 0.15, completionPerMillionUsd: 0.6 },
    { model: 'gpt-4o', promptPerMillionUsd: 2.5, completionPerMillionUsd: 10.0 },
    { model: 'gpt-4-turbo', promptPerMillionUsd: 10.0, completionPerMillionUsd: 30.0 },
  ],
  anthropic: [
    { model: 'claude-haiku-4-5', promptPerMillionUsd: 1.0, completionPerMillionUsd: 5.0 },
    { model: 'claude-sonnet-4-6', promptPerMillionUsd: 3.0, completionPerMillionUsd: 15.0 },
    { model: 'claude-opus-4-7', promptPerMillionUsd: 15.0, completionPerMillionUsd: 75.0 },
  ],
  gemini: [
    { model: 'gemini-3-flash-preview', promptPerMillionUsd: 0, completionPerMillionUsd: 0 },
    { model: 'gemini-1.5-pro', promptPerMillionUsd: 1.25, completionPerMillionUsd: 5.0 },
  ],
  mock: [{ model: 'mock-1', promptPerMillionUsd: 0, completionPerMillionUsd: 0 }],
};

export interface ProviderKeyPresence {
  openai: boolean;
  anthropic: boolean;
  gemini: boolean;
}

export function buildProviderAvailability(keys: ProviderKeyPresence): ProviderAvailabilityResponse {
  const providers: ProviderCatalog[] = Object.entries(CATALOG).map(([provider, models]) => ({
    provider,
    // mock is always usable; real providers depend on a configured key.
    available: provider === 'mock' ? true : (keys as unknown as Record<string, boolean>)[provider] ?? false,
    models: models.map((m) => ({
      model: m.model,
      promptPerMillionUsd: m.promptPerMillionUsd,
      completionPerMillionUsd: m.completionPerMillionUsd,
      priced: m.promptPerMillionUsd > 0 || m.completionPerMillionUsd > 0,
    })),
  }));
  return { providers, snapshotDate: PRICING_SNAPSHOT_DATE };
}
