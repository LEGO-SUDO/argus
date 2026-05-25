// derive-live-badge-state — the pure three-state machine behind the LiveBadge
// (LLD frontend-web Phase 2, Tasks 16-23; PRD §Live update behavior).
//
// Kept React-free so the thresholds + boundaries are unit-testable in
// isolation; `useLiveBadge` is a thin wrapper that polls the badge-lag endpoint
// and runs this each tick.
//
//   live   (green) — lag below the green threshold, no query error.
//   behind (amber) — green threshold <= lag < error threshold; the boundary
//                    at exactly the green threshold belongs to amber.
//   error  (red)   — lag >= error threshold, OR the badge query itself failed
//                    (queryError non-null) regardless of lag.

export type LiveBadgeState = 'live' | 'behind' | 'error';

export type LiveBadgeThresholds = {
  /** Lag below this is `live` (ms). */
  greenMs: number;
  /** Lag at or above this is `error` (ms). */
  errorMs: number;
};

// PRD defaults: 5s green, 30s error.
export const DEFAULT_LIVE_BADGE_THRESHOLDS: LiveBadgeThresholds = {
  greenMs: 5000,
  errorMs: 30000,
};

export type LiveBadgeView = {
  state: LiveBadgeState;
  label: string;
};

export type DeriveLiveBadgeInput = {
  lagMs: number;
  /** Non-null when the badge-lag query failed (network / DB unreachable). */
  queryError?: unknown;
  thresholds?: LiveBadgeThresholds;
};

const ERROR_LABEL = 'Ingestion failure';

export function deriveLiveBadgeState({
  lagMs,
  queryError = null,
  thresholds = DEFAULT_LIVE_BADGE_THRESHOLDS,
}: DeriveLiveBadgeInput): LiveBadgeView {
  // Query error dominates lag — a failed query means we cannot trust freshness.
  if (queryError !== null && queryError !== undefined) {
    return { state: 'error', label: ERROR_LABEL };
  }
  if (lagMs >= thresholds.errorMs) {
    return { state: 'error', label: ERROR_LABEL };
  }
  if (lagMs >= thresholds.greenMs) {
    const seconds = Math.floor(lagMs / 1000);
    return { state: 'behind', label: `${seconds}s behind` };
  }
  return { state: 'live', label: 'Live' };
}
