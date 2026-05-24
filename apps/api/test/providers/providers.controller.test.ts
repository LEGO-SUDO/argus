// chat-context-and-ux-polish LLD Tasks 70/72 — ProvidersController.
//
// Tests the catalog-passthrough contract by directly instantiating the
// controller with a stub `SDK_CATALOG` accessor — matches the rest of the
// api tests, which avoid @nestjs/testing for the same reason (keeps the
// dependency graph tight and the assertion surface explicit).
//
// SessionGuard 401 behavior is covered by the existing
// `apps/api/test/auth/session.guard.test.ts` suite and not duplicated here.
import { ProvidersController } from '../../src/providers/providers.controller';
import type { SdkCatalogAccessor } from '../../src/common/sdk-catalog.provider';
import type { ConfiguredProviderEntry } from '@argus/sdk';

interface StubResult {
  controller: ProvidersController;
  callCount: () => number;
}

function makeController(entries: ConfiguredProviderEntry[]): StubResult {
  let calls = 0;
  const stub: SdkCatalogAccessor = {
    listConfiguredProviders: () => {
      calls += 1;
      return entries;
    },
    getCatalogEntry: () => null,
    getEffectiveBudget: (d) => d,
  };
  const controller = new ProvidersController(stub);
  return { controller, callCount: () => calls };
}

describe('ProvidersController.list (Tasks 70/71/72/73)', () => {
  it('calls listConfiguredProviders exactly once per request and returns the payload under `providers`', () => {
    const entries: ConfiguredProviderEntry[] = [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptPerMillion: 0.15,
        completionPerMillion: 0.6,
        contextWindow: 128_000,
      },
    ];
    const { controller, callCount } = makeController(entries);
    const result = controller.list();
    expect(result.providers).toEqual(entries);
    expect(callCount()).toBe(1);
  });

  it('preserves explicit null cost / null context window fields (picker renders "—")', () => {
    const entries: ConfiguredProviderEntry[] = [
      {
        provider: 'openai',
        model: 'gpt-unicorn-9000',
        promptPerMillion: null,
        completionPerMillion: null,
        contextWindow: null,
      },
    ];
    const { controller } = makeController(entries);
    const result = controller.list();
    expect(result.providers).toHaveLength(1);
    const entry = result.providers[0]!;
    // Explicit null preserved — not omitted, not undefined.
    expect(entry.promptPerMillion).toBeNull();
    expect(entry.completionPerMillion).toBeNull();
    expect(entry.contextWindow).toBeNull();
    // JSON round-trip preserves the nulls explicitly (the picker's wire
    // shape is the canonical assertion).
    const wire = JSON.parse(JSON.stringify(result));
    expect(wire.providers[0].promptPerMillion).toBeNull();
    expect(wire.providers[0].contextWindow).toBeNull();
  });

  it('returns an empty providers array when the catalog is empty', () => {
    const { controller } = makeController([]);
    const result = controller.list();
    expect(result.providers).toEqual([]);
  });
});
