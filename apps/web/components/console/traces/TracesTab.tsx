// TracesTab — orchestrates the Traces tab (LLD Tasks 118-123 + Task 175 shell).
//
// Responsibilities:
//  - rehydrate the filter from the URL search params on mount (deep links),
//  - re-encode the active filter + window back into the URL on change
//    (so deep links stay shareable — Reviewer Concern: URL encode on change),
//  - debounce refetches on filter change AND on live SSE ticks (a Generate-
//    Samples burst must coalesce into one refetch),
//  - render the throughput strip, filter bar, and the row feed (or EmptyState).
//
// The model + conversation filter options are derived from the loaded rows so
// the tab needs no extra contract surface.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { TimeWindow, TraceListResponse } from '@argus/contracts';
import { fetchTraces, generateSample } from '@/lib/console-api';
import { useConsoleLive } from '@/lib/use-console-live';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import {
  decodeTracesFilter,
  encodeTracesFilter,
  type TracesFilter,
} from '@/lib/traces-filter-encoding';

import { ThroughputStrip } from './ThroughputStrip';
import { TracesFilterBar } from './TracesFilterBar';
import { TraceRow } from './TraceRow';
import { EmptyState } from '../EmptyState';
import { TimeWindowToggle } from '../TimeWindowToggle';

export type TracesTabProps = {
  initialData: TraceListResponse;
  initialWindow: TimeWindow;
  /** Raw URL search params — decoded into the initial filter on mount. */
  initialSearchParams?: URLSearchParams;
  /** Debounce window for filter-change + live-tick refetches (ms). */
  refetchDebounceMs?: number;
};

export function TracesTab({
  initialData,
  initialWindow,
  initialSearchParams,
  refetchDebounceMs = 300,
}: TracesTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { subscribe } = useConsoleLive();

  const [data, setData] = useState<TraceListResponse>(initialData);
  const [windowValue, setWindowValue] = useState<TimeWindow>(initialWindow);
  const [filter, setFilter] = useState<TracesFilter>(() =>
    decodeTracesFilter(initialSearchParams ?? new URLSearchParams()),
  );

  // Refs so the stable SSE listener reads the freshest filter / window.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const windowRef = useRef(windowValue);
  windowRef.current = windowValue;

  const doRefetch = useCallback(async (f: TracesFilter, w: TimeWindow) => {
    try {
      const res = await fetchTraces({ window: w, filter: f });
      setData(res);
    } catch {
      // Keep the last good data on a transient failure; the next tick or
      // user action retries. (A visible error banner is out of scope here.)
    }
  }, []);

  const debouncedRefetch = useDebouncedCallback(
    (f: TracesFilter, w: TimeWindow) => void doRefetch(f, w),
    refetchDebounceMs,
  );

  const pushUrl = useCallback(
    (f: TracesFilter, w: TimeWindow) => {
      const params = encodeTracesFilter(f);
      params.set('window', w);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname],
  );

  const handleFilterChange = useCallback(
    (next: TracesFilter) => {
      setFilter(next);
      pushUrl(next, windowRef.current);
      debouncedRefetch(next, windowRef.current);
    },
    [pushUrl, debouncedRefetch],
  );

  const handleWindowChange = useCallback(
    (next: TimeWindow) => {
      setWindowValue(next);
      pushUrl(filterRef.current, next);
      debouncedRefetch(filterRef.current, next);
    },
    [pushUrl, debouncedRefetch],
  );

  // EmptyState CTA: generate samples then refetch the slice immediately.
  const handleGenerateSamples = useCallback(async () => {
    try {
      await generateSample();
    } finally {
      void doRefetch(filterRef.current, windowRef.current);
    }
  }, [doRefetch]);

  // Live tick → debounced refetch (burst coalesces into one).
  useEffect(() => {
    const unsubscribe = subscribe(
      () => true,
      () => debouncedRefetch(filterRef.current, windowRef.current),
    );
    return unsubscribe;
  }, [subscribe, debouncedRefetch]);

  const models = useMemo(
    () => Array.from(new Set(data.rows.map((r) => r.model))),
    [data.rows],
  );
  const conversations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of data.rows) {
      if (!seen.has(r.conversationId)) {
        seen.set(r.conversationId, r.conversationTitle ?? 'Untitled conversation');
      }
    }
    return Array.from(seen, ([id, title]) => ({ id, title }));
  }, [data.rows]);

  return (
    <div data-testid="console-traces-tab" className="flex flex-col gap-4">
      <h1 className="sr-only">Traces</h1>
      <div className="flex items-center justify-between gap-3">
        <ThroughputStrip throughput={data.throughput} />
        <TimeWindowToggle value={windowValue} onChange={handleWindowChange} />
      </div>
      <TracesFilterBar
        value={filter}
        onChange={handleFilterChange}
        models={models}
        conversations={conversations}
        searchDebounceMs={refetchDebounceMs}
      />
      {data.rows.length === 0 ? (
        <EmptyState scope="traces" onGenerateSamples={handleGenerateSamples} />
      ) : (
        <div data-testid="console-traces-feed">
          {data.rows.map((row) => (
            <TraceRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
