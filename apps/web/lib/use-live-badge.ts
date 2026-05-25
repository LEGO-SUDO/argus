// use-live-badge — React hook that polls the badge-lag endpoint and runs the
// pure `deriveLiveBadgeState` derivation each tick (LLD frontend-web Phase 2,
// Tasks 24-29).
//
// The badge is a self-scheduling REST poll of `/api/console/live/badge` — NOT
// reconstructed from the SSE stream. Each poll's `lagSeconds` feeds the
// derivation so the green/amber/red thresholds stay client-consistent; a failed
// poll (or a server-reported `error` state) surfaces as the `error` badge. Late
// responses after unmount are dropped.
//
// Scheduling (perf): we schedule the NEXT poll only AFTER the current one
// settles (recursive setTimeout), never on a fixed setInterval. A fixed 1s
// interval fired a new request every second even while the previous was still
// in flight — under DB contention those piled up, saturating the browser's
// ~6-connections-per-host limit and starving other console requests (the Replay
// detail poll in particular: the server had the diff in seconds but the client
// couldn't fetch it for minutes). Self-scheduling caps it at one in-flight poll
// at a time, and the cadence is a calmer 5s (ingestion health doesn't need 1s).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchBadgeLag } from './console-api';
import {
  deriveLiveBadgeState,
  DEFAULT_LIVE_BADGE_THRESHOLDS,
  type LiveBadgeThresholds,
  type LiveBadgeView,
} from './derive-live-badge-state';

const DEFAULT_CADENCE_MS = 5000;

export type UseLiveBadgeOptions = {
  /** Delay between the end of one poll and the start of the next (default 5000). */
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
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Recursive schedule: each poll's completion arms the next one. `poll`
    // swallows its own errors (never rejects), so a slow/failed badge request
    // can't break the loop — it just delays the next tick. Result: at most one
    // badge request in flight at any time, so it never starves other requests.
    const tick = async () => {
      await poll();
      if (!mountedRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, cadenceMs);
    };
    void tick();
    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [poll, cadenceMs]);

  return { ...view, refetch: poll };
}
