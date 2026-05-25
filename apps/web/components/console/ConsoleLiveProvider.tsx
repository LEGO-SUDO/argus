// ConsoleLiveProvider — opens the single shared SSE stream for the `/console`
// surface and fans ticks out to the tabs via React context.
//
// LLD frontend-web Phase 5 (Tasks 63, 67, 69). Mounted once in the console
// layout so all three tabs share one EventSource. Maintains the latest valid
// tick in state and notifies predicate-filtered subscribers; SSE errors
// (validation / transport) are notification-only and deliberately do NOT
// advance the context (a malformed event must not poison every tab's refetch).
// Closes the client exactly once on unmount.

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { SseClient } from '@/lib/sse-client';
import type { LiveEvent } from '@argus/contracts';
import {
  ConsoleLiveContext,
  type LiveTickListener,
  type LiveTickPredicate,
} from '@/lib/use-console-live';

type Subscriber = { predicate: LiveTickPredicate; listener: LiveTickListener };

export type ConsoleLiveProviderProps = {
  children?: ReactNode;
  /** Injectable SSE client for tests; production opens its own. */
  client?: SseClient;
  /** Override the SSE URL (defaults to `defaultSseUrl()` inside SseClient). */
  url?: string;
};

export function ConsoleLiveProvider({ children, client, url }: ConsoleLiveProviderProps) {
  const [latestTick, setLatestTick] = useState<LiveEvent | null>(null);
  const subscribersRef = useRef<Set<Subscriber>>(new Set());

  const subscribe = useCallback(
    (predicate: LiveTickPredicate, listener: LiveTickListener) => {
      const sub: Subscriber = { predicate, listener };
      subscribersRef.current.add(sub);
      return () => {
        subscribersRef.current.delete(sub);
      };
    },
    [],
  );

  useEffect(() => {
    const sse = client ?? new SseClient(url);
    sse.onEvent((event) => {
      setLatestTick(event);
      subscribersRef.current.forEach((sub) => {
        if (sub.predicate(event)) {
          sub.listener(event);
        }
      });
    });
    // Notification-only: a validation/transport error never advances context.
    sse.onError(() => undefined);
    return () => {
      sse.close();
    };
  }, [client, url]);

  const value = useMemo(() => ({ latestTick, subscribe }), [latestTick, subscribe]);

  return <ConsoleLiveContext.Provider value={value}>{children}</ConsoleLiveContext.Provider>;
}
