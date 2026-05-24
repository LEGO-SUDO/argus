// Nest provider for the SDK catalog accessor.
//
// chat-context-and-ux-polish LLD Task 55 + Codex-vagueness fix:
//
// `SDK_CATALOG` is the injection token consumers (ContextMeterService,
// ProvidersController, ConversationsController) use to read the picker's
// catalog and the budget-cap accessors. Backed by the SDK's
// `listConfiguredProviders` helper plus `getCatalogEntry` and
// `getEffectiveBudget` (already exported `@internal` from packages/sdk).
//
// Tests override the token via
// `Test.createTestingModule({ providers: [{ provide: SDK_CATALOG, useValue: stub }] })`.
import {
  listConfiguredProviders,
  getCatalogEntry,
  getEffectiveBudget,
  type ConfiguredProviderEntry,
  type CatalogEntryReadout,
  type PinDescriptor,
} from '@argus/sdk';

// Token literal (string) so the test override is ergonomic — Nest's `Inject`
// accepts symbols or strings; string keeps stack traces readable.
export const SDK_CATALOG = 'SDK_CATALOG';

/** What the token resolves to — the contract every consumer reads. */
export interface SdkCatalogAccessor {
  /** Enumerate every (provider, model) the picker can offer. */
  listConfiguredProviders(): ConfiguredProviderEntry[];
  /** Look up a single entry; null when not in the catalog. */
  getCatalogEntry(provider: string, model: string): CatalogEntryReadout | null;
  /** Compute the effective context budget given the configured default + optional pin. */
  getEffectiveBudget(configuredDefault: number, pin?: PinDescriptor): number;
}

/** Default accessor — production wiring. */
export const sdkCatalogAccessor: SdkCatalogAccessor = {
  listConfiguredProviders: () => listConfiguredProviders(),
  getCatalogEntry: (provider, model) => getCatalogEntry(provider as never, model),
  getEffectiveBudget,
};

/** Nest provider object — drop into `module.providers`. */
export const SdkCatalogProvider = {
  provide: SDK_CATALOG,
  useValue: sdkCatalogAccessor,
};
