// `listConfiguredProviders` — aggregator that joins each adapter's
// `listModels()` against the catalog (cost.ts `getCatalogEntry`) and returns
// a flat list the picker REST endpoint can ship over the wire without further
// hydration.
//
// chat-context-and-ux-polish LLD Tasks 24/25 + Codex-vagueness fix:
//   - For each configured adapter (`isConfigured()` true), expand
//     `listModels()` and join with `getCatalogEntry`.
//   - Mock is additionally gated by `MOCK_PROVIDER` env: the picker shows
//     it ONLY when MOCK_PROVIDER=true. Production deployments with real
//     keys set MOCK_PROVIDER=false and the mock entry vanishes.
//   - Unknown catalog entries surface with null cost AND null context
//     window — not undefined, not omitted — so the picker can render
//     "—" without conditional defaults. The contract is "always emit the
//     keys, sometimes null".
//
// The default adapter map is the real one (router's singleton adapters),
// but `opts.adapters` overrides it for tests (parallel to
// `RouterOptions.adapters`).

import type { ProviderAdapter, ProviderName } from './types';
import { getCatalogEntry } from '../cost';
import { mockProvider } from './mock';
import { openaiProvider } from './openai';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';

/** Single picker-catalog entry. Null fields are intentional — see module docstring. */
export interface ConfiguredProviderEntry {
  provider: ProviderName;
  model: string;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  contextWindow: number | null;
}

export interface ListConfiguredProvidersOptions {
  /** Override the adapter registry (tests). Mirrors RouterOptions.adapters. */
  adapters?: Partial<Record<ProviderName, ProviderAdapter>>;
  /** Override MOCK_PROVIDER env (tests). When undefined, reads process.env. */
  mockEnabled?: boolean;
}

/**
 * Enumerate every (provider, model) pair the picker can offer to the user.
 *
 * @internal — re-exported from the SDK index so apps/api can inject it via
 *             Nest's SDK_CATALOG provider token. Not part of the public SDK
 *             surface promised to external SDK consumers.
 */
export function listConfiguredProviders(
  opts: ListConfiguredProvidersOptions = {},
): ConfiguredProviderEntry[] {
  const adapters: Record<ProviderName, ProviderAdapter> = {
    mock: opts.adapters?.mock ?? mockProvider,
    openai: opts.adapters?.openai ?? openaiProvider,
    anthropic: opts.adapters?.anthropic ?? anthropicProvider,
    gemini: opts.adapters?.gemini ?? geminiProvider,
  };
  const mockEnabled = opts.mockEnabled ?? envMockEnabled();
  const result: ConfiguredProviderEntry[] = [];

  // Iteration order is fixed (openai, anthropic, gemini, mock) so the picker
  // surfaces the same default ordering across reloads. The picker UI is free
  // to re-sort.
  const order: ProviderName[] = ['openai', 'anthropic', 'gemini', 'mock'];

  for (const name of order) {
    const adapter = adapters[name];
    if (!adapter) continue;
    if (!adapter.isConfigured()) continue;
    if (name === 'mock' && !mockEnabled) continue;
    for (const model of adapter.listModels()) {
      const entry = getCatalogEntry(name, model);
      result.push({
        provider: name,
        model,
        // Explicit null preserved — see module docstring; null means "we
        // don't have catalog data for this entry yet; render '—'".
        promptPerMillion: entry?.promptPerMillion ?? null,
        completionPerMillion: entry?.completionPerMillion ?? null,
        contextWindow: entry?.contextWindow ?? null,
      });
    }
  }

  return result;
}

function envMockEnabled(): boolean {
  const raw = process.env.MOCK_PROVIDER;
  // Default true (keyless dev) — same rule the router uses.
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}
