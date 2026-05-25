import { computeDiff } from '../../src/replay/diff';

const CAP = 262_144;

describe('computeDiff', () => {
  it('returns a word-level change list isolating the replaced word', () => {
    const result = computeDiff('the quick brown fox', 'the quick red fox', CAP);
    expect('changes' in result).toBe(true);
    if ('changes' in result) {
      const removed = result.changes.find((c) => c.removed);
      const added = result.changes.find((c) => c.added);
      expect(removed?.value).toContain('brown');
      expect(added?.value).toContain('red');
      // Equal segments are tagged neither added nor removed.
      const equal = result.changes.filter((c) => !c.added && !c.removed);
      expect(equal.length).toBeGreaterThan(0);
    }
  });

  it('returns a tooLarge sentinel when either input exceeds the cap', () => {
    const big = 'x'.repeat(CAP + 1);
    expect(computeDiff(big, 'small', CAP)).toEqual({ tooLarge: true });
    expect(computeDiff('small', big, CAP)).toEqual({ tooLarge: true });
    // Both under the cap → a normal change list.
    expect('changes' in computeDiff('a', 'b', CAP)).toBe(true);
  });
});
