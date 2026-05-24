// Phase A context-window heuristic — drop-oldest-first by token-budget.
//
// These tests pin the behavior backing MessageListResponse.omittedCount
// (frontend-web Task 42 "N earlier messages omitted from context"). The real
// SDK builder will replace this in Phase B; the shape (rows in, count out)
// must stay stable so the controller wiring doesn't churn.
import { computeOmittedCount } from '../../src/conversations/context-window';

function rows(...contents: string[]): { content: string }[] {
  return contents.map((content) => ({ content }));
}

const ORIGINAL_ENV = process.env.CONTEXT_TOKEN_BUDGET;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.CONTEXT_TOKEN_BUDGET;
  else process.env.CONTEXT_TOKEN_BUDGET = ORIGINAL_ENV;
});

describe('computeOmittedCount', () => {
  it('returns 0 for an empty conversation', () => {
    expect(computeOmittedCount([])).toBe(0);
  });

  it('returns 0 for a single message regardless of size', () => {
    expect(computeOmittedCount(rows('x'.repeat(100_000)))).toBe(0);
  });

  it('returns 0 when total tokens fit in the budget', () => {
    process.env.CONTEXT_TOKEN_BUDGET = '6000';
    // 10 messages of ~100 tokens each = ~1000 tokens total, well under 6000.
    const ms = Array.from({ length: 10 }, () => 'a'.repeat(400)); // ~100 tokens each
    expect(computeOmittedCount(rows(...ms))).toBe(0);
  });

  it('drops the oldest messages once the budget is exceeded', () => {
    process.env.CONTEXT_TOKEN_BUDGET = '100'; // very small for the test
    // Each message is 200 chars = 50 tokens. Budget 100 → keep last 2,
    // drop the older 3.
    const ms = rows(
      'a'.repeat(200),
      'b'.repeat(200),
      'c'.repeat(200),
      'd'.repeat(200),
      'e'.repeat(200),
    );
    expect(computeOmittedCount(ms)).toBe(3);
  });

  it('always keeps the most-recent message even if it alone exceeds the budget', () => {
    process.env.CONTEXT_TOKEN_BUDGET = '10';
    // Newest message alone is 200 chars = 50 tokens > 10 budget. Keep it
    // anyway (the SDK input handler trims; we should not silently drop the
    // user's just-sent prompt).
    const ms = rows('older'.repeat(1), 'x'.repeat(200));
    expect(computeOmittedCount(ms)).toBe(1);
  });

  it('falls back to the default budget when env is unset (LLD Task 51 bump: 10000)', () => {
    delete process.env.CONTEXT_TOKEN_BUDGET;
    // Default is now 10000 tokens (PRD bump in chat-context-and-ux-polish).
    // 30 messages of 100 chars = 25 tokens each → 750 tokens, well under default.
    const ms = Array.from({ length: 30 }, () => 'a'.repeat(100));
    expect(computeOmittedCount(rows(...ms))).toBe(0);
  });

  it('falls back to the default budget when env is non-numeric', () => {
    process.env.CONTEXT_TOKEN_BUDGET = 'not-a-number';
    const ms = Array.from({ length: 30 }, () => 'a'.repeat(100));
    expect(computeOmittedCount(rows(...ms))).toBe(0);
  });
});
