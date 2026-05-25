import {
  computeCost,
  priceFor,
  getCatalogEntry,
  getEffectiveBudget,
} from '../cost';

describe('cost.computeCost', () => {
  it('computes micro-USD for a known model', () => {
    // gpt-4o-mini: $0.15 per 1M prompt, $0.6 per 1M completion.
    // 1M tokens prompt = 150_000 micro-USD. 1M tokens completion = 600_000 micro-USD.
    const out = computeCost('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);
    expect(out.promptMicros).toBe(150_000);
    expect(out.completionMicros).toBe(600_000);
  });

  it('scales linearly for fractional token counts', () => {
    // 100k prompt tokens at $0.15/1M → 15_000 micro-USD
    const out = computeCost('openai', 'gpt-4o-mini', 100_000, 0);
    expect(out.promptMicros).toBe(15_000);
    expect(out.completionMicros).toBe(0);
  });

  it('returns zero for unknown model', () => {
    const out = computeCost('openai', 'gpt-unicorn-9000', 1_000, 1_000);
    expect(out).toEqual({ promptMicros: 0, completionMicros: 0 });
  });

  it('treats missing token counts as zero rather than throwing', () => {
    const out = computeCost('anthropic', 'claude-3-5-haiku-latest', undefined, undefined);
    expect(out).toEqual({ promptMicros: 0, completionMicros: 0 });
  });

  it('rounds to integer micros (no float drift)', () => {
    // anthropic claude-3-5-haiku-latest: $0.8 prompt → 1 token = 0.0000008 USD = 0.8 micro
    const out = computeCost('anthropic', 'claude-3-5-haiku-latest', 1, 1);
    expect(Number.isInteger(out.promptMicros)).toBe(true);
    expect(Number.isInteger(out.completionMicros)).toBe(true);
  });

  it('priceFor exposes the static entries for sanity checks', () => {
    expect(priceFor('openai', 'gpt-4o-mini')).toEqual({
      promptPerMillion: 0.15,
      completionPerMillion: 0.6,
    });
    expect(priceFor('mock', 'mock-1')).toEqual({
      promptPerMillion: 0,
      completionPerMillion: 0,
    });
    expect(priceFor('openai', 'nope')).toBeUndefined();
  });
});

// chat-context-and-ux-polish LLD Tasks 15-18 — context-window + budget
// accessors. The picker UI needs catalog-side numbers (`getCatalogEntry`),
// and the gateway needs an effective budget (`getEffectiveBudget`) that
// respects the pinned model's window.
describe('cost.getCatalogEntry (Tasks 15/16)', () => {
  it('returns combined cost + integer context window for known openai entries', () => {
    const entry = getCatalogEntry('openai', 'gpt-4o-mini');
    expect(entry).not.toBeNull();
    expect(entry!.promptPerMillion).toBe(0.15);
    expect(entry!.completionPerMillion).toBe(0.6);
    expect(Number.isInteger(entry!.contextWindow)).toBe(true);
    expect(entry!.contextWindow).toBe(128_000);
  });

  it('returns the right context windows per provider family', () => {
    expect(getCatalogEntry('openai', 'gpt-3.5-turbo')!.contextWindow).toBe(16_000);
    expect(getCatalogEntry('anthropic', 'claude-haiku-4-5')!.contextWindow).toBe(200_000);
    expect(getCatalogEntry('anthropic', 'claude-3-haiku-20240307')!.contextWindow).toBe(200_000);
    expect(getCatalogEntry('gemini', 'gemini-2.5-flash')!.contextWindow).toBe(1_048_576);
    expect(getCatalogEntry('gemini', 'gemini-2.5-pro')!.contextWindow).toBe(2_097_152);
    expect(getCatalogEntry('mock', 'mock-1')!.contextWindow).toBe(8192);
  });

  it('returns null for unknown (provider, model)', () => {
    expect(getCatalogEntry('openai', 'gpt-unicorn-9000')).toBeNull();
    expect(getCatalogEntry('anthropic', 'claude-not-yet-shipped')).toBeNull();
  });
});

describe('cost.getEffectiveBudget (Tasks 17/18)', () => {
  it('returns the configured default when no pin is supplied', () => {
    expect(getEffectiveBudget(10000)).toBe(10000);
    expect(getEffectiveBudget(10000, undefined)).toBe(10000);
  });

  it('returns the configured default when pinned model window is LARGER than default', () => {
    // openai:gpt-4o-mini has a 128k window; default 10000 < 128_000 → 10000.
    expect(getEffectiveBudget(10000, { provider: 'openai', model: 'gpt-4o-mini' })).toBe(10000);
  });

  it('returns the pinned model window when it is SMALLER than the default', () => {
    // mock:mock-1 has 8192 window; default 10000 → cap to 8192.
    expect(getEffectiveBudget(10000, { provider: 'mock', model: 'mock-1' })).toBe(8192);
  });

  it('tolerates unknown pin (returns configured default without throwing)', () => {
    expect(getEffectiveBudget(10000, { provider: 'openai', model: 'gpt-unicorn-9000' })).toBe(10000);
    expect(() =>
      getEffectiveBudget(10000, { provider: 'openai', model: 'gpt-unicorn-9000' }),
    ).not.toThrow();
  });
});
