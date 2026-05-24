import { computeCost, priceFor } from '../cost';

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
