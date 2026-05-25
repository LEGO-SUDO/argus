// Tests for the pure live-badge state derivation (LLD Tasks 16, 18, 20, 22).
import {
  deriveLiveBadgeState,
  DEFAULT_LIVE_BADGE_THRESHOLDS,
} from '@/lib/derive-live-badge-state';

const T = DEFAULT_LIVE_BADGE_THRESHOLDS; // { greenMs: 5000, errorMs: 30000 }

describe('deriveLiveBadgeState — live (Task 16)', () => {
  it('returns live with the literal "Live" label when lag is under the green threshold', () => {
    expect(deriveLiveBadgeState({ lagMs: 1200 })).toEqual({ state: 'live', label: 'Live' });
  });
});

describe('deriveLiveBadgeState — behind (Task 18)', () => {
  it('returns behind with an integer-second label between the thresholds', () => {
    const result = deriveLiveBadgeState({ lagMs: 12_400 });
    expect(result.state).toBe('behind');
    // 12_400ms floored to whole seconds -> 12 (no fractional seconds).
    expect(result.label).toContain('12');
    expect(result.label).not.toContain('.');
  });

  it('treats the green threshold itself as the boundary into amber (behind)', () => {
    expect(deriveLiveBadgeState({ lagMs: T.greenMs }).state).toBe('behind');
  });
});

describe('deriveLiveBadgeState — error by lag (Task 20)', () => {
  it('returns error with an ingestion-failure label at or above the error threshold', () => {
    const atThreshold = deriveLiveBadgeState({ lagMs: T.errorMs });
    expect(atThreshold.state).toBe('error');
    expect(atThreshold.label).toMatch(/ingestion failure/i);
    expect(deriveLiveBadgeState({ lagMs: T.errorMs + 5000 }).state).toBe('error');
  });
});

describe('deriveLiveBadgeState — query error precedence (Task 22)', () => {
  it('forces error whenever queryError is non-null, even for tiny lag', () => {
    const result = deriveLiveBadgeState({ lagMs: 0, queryError: new Error('db down') });
    expect(result.state).toBe('error');
    expect(result.label).toMatch(/ingestion failure/i);
  });

  it('ignores a null queryError', () => {
    expect(deriveLiveBadgeState({ lagMs: 0, queryError: null }).state).toBe('live');
  });
});

describe('deriveLiveBadgeState — custom thresholds', () => {
  it('honors tunable thresholds', () => {
    const thresholds = { greenMs: 1000, errorMs: 4000 };
    expect(deriveLiveBadgeState({ lagMs: 1500, thresholds }).state).toBe('behind');
    expect(deriveLiveBadgeState({ lagMs: 4000, thresholds }).state).toBe('error');
    expect(deriveLiveBadgeState({ lagMs: 999, thresholds }).state).toBe('live');
  });
});
