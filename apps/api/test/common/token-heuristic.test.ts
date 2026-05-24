// chat-context-and-ux-polish LLD Tasks 48/50 — shared token-heuristic.
//
// Both ContextMeterService (chat module) and the conversations controller
// consume this helper, so it lives in `common/` to avoid a cross-module
// import either direction.
import { defaultContextBudget, estimateTokens } from '../../src/common/token-heuristic';

const ORIGINAL_BUDGET = process.env.CONTEXT_TOKEN_BUDGET;

afterEach(() => {
  if (ORIGINAL_BUDGET === undefined) delete process.env.CONTEXT_TOKEN_BUDGET;
  else process.env.CONTEXT_TOKEN_BUDGET = ORIGINAL_BUDGET;
});

describe('estimateTokens (Task 48)', () => {
  it('returns 0 for empty content', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses 4 chars per token (ceiling)', () => {
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('always returns a non-negative integer', () => {
    const samples = ['hi', 'a'.repeat(17), '🚀'.repeat(5)];
    for (const s of samples) {
      const n = estimateTokens(s);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('defaultContextBudget (Tasks 48/50)', () => {
  it('returns 10000 when CONTEXT_TOKEN_BUDGET is unset (PRD default)', () => {
    delete process.env.CONTEXT_TOKEN_BUDGET;
    expect(defaultContextBudget()).toBe(10_000);
  });

  it('returns the configured env value when set', () => {
    process.env.CONTEXT_TOKEN_BUDGET = '4096';
    expect(defaultContextBudget()).toBe(4096);
  });

  it('falls back to the PRD default on unparseable env values', () => {
    process.env.CONTEXT_TOKEN_BUDGET = 'not-a-number';
    expect(defaultContextBudget()).toBe(10_000);
    process.env.CONTEXT_TOKEN_BUDGET = '0';
    expect(defaultContextBudget()).toBe(10_000);
    process.env.CONTEXT_TOKEN_BUDGET = '-5';
    expect(defaultContextBudget()).toBe(10_000);
  });
});
