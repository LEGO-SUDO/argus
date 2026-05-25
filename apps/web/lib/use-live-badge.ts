// use-live-badge — React hook that polls the badge-lag endpoint and runs the
// pure `deriveLiveBadgeState` derivation each tick (LLD frontend-web Phase 2,
// Tasks 24-29).
//
// The badge is a fixed-cadence REST poll of `/api/console/live/badge` (default
// 1s, per the LLD assumption) — NOT reconstructed from the SSE stream. Each
// poll's `lagSeconds` feeds the derivation so the green/amber/red thresholds
// stay client-consistent; a failed poll (or a server-reported `error` state)
// surfaces as the `error` badge. Late responses after unmount are dropped.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchBadgeLag } from './console-api';
import {
  deriveLiveBadgeState,
  DEFAULT_LIVE_BADGE_THRESHOLDS,
  type LiveBadgeThresholds,
  type LiveBadgeView,
} from './derive-live-badge-state';

const DEFAULT_CADENCE_MS = 1000;

export type UseLiveBadgeOptions = {
  /** Poll cadence in ms (default 1000). */
  cadenceMs?: number;
  /** Override the green/error thresholds (default 5s/30s). */
  thresholds?: LiveBadgeThresholds;
};

export type UseLiveBadgeResult = LiveBadgeView & {
  /** Imperative re-poll — wired to the LiveBadge error-state Retry button. */
  refetch: () => Promise<void>;
};

export function useLiveBadge(options: UseLiveBadgeOptions = {}): UseLiveBadgeResult {
  const { cadenceMs = DEFAULT_CADENCE_MS, thresholds = DEFAULT_LIVE_BADGE_THRESHOLDS } =
    options;

  const [view, setView] = useState<LiveBadgeView>({ state: 'live', label: 'Live' });

  const mountedRef = useRef(true);
  // Keep thresholds in a ref so `poll` stays referentially stable while still
  // deriving against the latest values.
  const thresholdsRef = useRef(thresholds);
  thresholdsRef.current = thresholds;

  const poll = useCallback(async () => {
    try {
      const res = await fetchBadgeLag();
      if (!mountedRef.current) return;
      const lagMs = (res.lagSeconds ?? 0) * 1000;
      // A server-reported `error` state (e.g. DB unreachable) carries no lag —
      // treat it as a query error so the derivation lands on `error`.
      const queryError = res.state === 'error' ? (res.message ?? 'ingestion error') : null;
      setView(deriveLiveBadgeState({ lagMs, queryError, thresholds: thresholdsRef.current }));
    } catch (err) {
      if (!mountedRef.current) return;
      setView(
        deriveLiveBadgeState({ lagMs: 0, queryError: err, thresholds: thresholdsRef.current }),
      );
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void poll();
    const id = setInterval(() => {
      void poll();
    }, cadenceMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [poll, cadenceMs]);

  return { ...view, refetch: poll };
}
