// use-console-live — the console's live-tick context + consumer hook.
//
// LLD frontend-web Phase 5 (Tasks 62-69). The `ConsoleLiveProvider` owns the
// single shared `SseClient`; this module owns the context shape and the hook
// the tabs consume. Per HLD D3 the tick is a NOTIFICATION ("refetch your
// slice"), so the hook exposes the latest tick plus a predicate-filtered
// `subscribe` helper each tab uses to register a (debounced) refetch.

'use client';

import { createContext, useContext } from 'react';
import type { LiveEvent } from '@argus/contracts';

export type LiveTickPredicate = (event: LiveEvent) => boolean;
export type LiveTickListener = (event: LiveEvent) => void;

export type ConsoleLiveContextValue = {
  /** The most recent valid tick, or null before any has arrived. */
  latestTick: LiveEvent | null;
  /**
   * Register a listener that fires only for ticks matching `predicate`.
   * Returns an unsubscribe function — call it from an effect cleanup.
   */
  subscribe: (predicate: LiveTickPredicate, listener: LiveTickListener) => () => void;
};

export const ConsoleLiveContext = createContext<ConsoleLiveContextValue | null>(null);

/** Read the console live context. Throws if used outside `<ConsoleLiveProvider>`. */
export function useConsoleLive(): ConsoleLiveContextValue {
  const ctx = useContext(ConsoleLiveContext);
  if (ctx === null) {
    throw new Error('useConsoleLive must be used within a <ConsoleLiveProvider>');
  }
  return ctx;
}
