// TracesTab — orchestrates the Traces tab (LLD Tasks 118-123 + Task 175 shell).
//
// Reskinned to the dev-tool dense design language (REVIEW-BRIEF Finding 4):
//   - .con-statrow stat strip (4 stats derived from throughput + rows)
//   - .con-tools filter row (multi-select triggers + search + window-switch)
//   - .con-tablewrap > table.con-table (7-column trace table)
//   - TraceDrawer slide-in on row click
//   - SSE live new-row flash (.new-row class on freshly-arrived rows)
//
// Responsibilities preserved from before:
//   - URL deep-link rehydration / re-encoding on change
//   - Debounced refetches coalescing filter-change + SSE bursts
//   - Multi-select provider/model/status/conversation + free-text search
//   - Pagination cursor preserved in state (next_cursor)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { TimeWindow, TraceListResponse, TraceRow as TraceRowDto } from '@argus/contracts';
import { fetchTraces, generateSample } from '@/lib/console-api';
import { useConsoleLive } from '@/lib/use-console-live';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import {
  emptyTracesFilter,
  encodeTracesFilter,
  type TracesFilter,
} from '@/lib/traces-filter-encoding';

import { ThroughputStrip } from './ThroughputStrip';
import { TracesFilterBar } from './TracesFilterBar';
import { TraceRow } from './TraceRow';
import { TraceDrawer } from './TraceDrawer';
import { EmptyState } from '../EmptyState';
import { TimeWindowToggle } from '../TimeWindowToggle';

// ---- helpers ----------------------------------------------------------------

/** Sorted ascending numeric quantile. Returns 0 for empty array. */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round(sorted[idx]!);
}

// ---- props ------------------------------------------------------------------

export type TracesTabProps = {
  initialData: TraceListResponse;
  initialWindow: TimeWindow;
  /** Initial filter, decoded server-side from the URL (deep-link support). */
  initialFilter?: TracesFilter;
  /** Debounce window for filter-change + live-tick refetches (ms). */
  refetchDebounceMs?: number;
};

// ---- component --------------------------------------------------------------

export function TracesTab({
  initialData,
  initialWindow,
  initialFilter,
  refetchDebounceMs = 300,
}: TracesTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { subscribe } = useConsoleLive();

  const [data, setData] = useState<TraceListResponse>(initialData);
  const [windowValue, setWindowValue] = useState<TimeWindow>(initialWindow);
  const [filter, setFilter] = useState<TracesFilter>(
    () => initialFilter ?? emptyTracesFilter(),
  );
  // Selected trace id for the drawer (null = closed)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Set of ids flashing as new rows (~2.5s)
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const lastSeenRef = useRef(initialData.rows.length);

  // Refs so stable SSE listener always reads the freshest filter / window.
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

  // EmptyState CTA: generate samples then refetch immediately.
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

  // Flash newly-arrived rows (.new-row class for ~2.5s).
  useEffect(() => {
    if (data.rows.length <= lastSeenRef.current) {
      // No new rows — nothing to flash.
      return;
    }
    const fresh = data.rows
      .slice(lastSeenRef.current)
      .map((r: TraceRowDto) => r.id);
    setFlashIds((s) => new Set([...s, ...fresh]));
    const timer = setTimeout(() => {
      setFlashIds((s) => {
        const n = new Set(s);
        fresh.forEach((id) => n.delete(id));
        return n;
      });
    }, 2500);
    lastSeenRef.current = data.rows.length;
    return () => clearTimeout(timer);
  }, [data.rows]);

  // Derived option lists for filter controls
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

  // Latency p50 / p95 derived from loaded rows (for stat strip)
  const { latencyP50, latencyP95 } = useMemo(() => {
    const okLatencies = data.rows
      .filter((r) => r.status === 'ok' && r.latencyMs !== null)
      .map((r) => r.latencyMs as number);
    return {
      latencyP50: okLatencies.length > 0 ? quantile(okLatencies, 0.5) : null,
      latencyP95: okLatencies.length > 0 ? quantile(okLatencies, 0.95) : null,
    };
  }, [data.rows]);

  // Currently selected trace (for drawer)
  const selectedTrace = useMemo(
    () => (selectedId ? data.rows.find((r) => r.id === selectedId) ?? null : null),
    [selectedId, data.rows],
  );

  return (
    <>
      <h1 className="sr-only">Traces</h1>

      {/* Stat strip */}
      <ThroughputStrip
        throughput={data.throughput}
        latencyP50={latencyP50}
        latencyP95={latencyP95}
      />

      {/* Filter / toolbar row */}
      <div
        data-testid="console-traces-tab"
        className="con-tools"
        role="toolbar"
        aria-label="Trace filters"
      >
        <TracesFilterBar
          value={filter}
          onChange={handleFilterChange}
          models={models}
          conversations={conversations}
          searchDebounceMs={refetchDebounceMs}
        />
        <TimeWindowToggle value={windowValue} onChange={handleWindowChange} />
      </div>

      {/* Content: empty state or the table */}
      {data.rows.length === 0 ? (
        <EmptyState scope="traces" onGenerateSamples={handleGenerateSamples} />
      ) : (
        <div
          className="con-tablewrap"
          data-testid="console-traces-feed"
        >
          <table className="con-table" role="table" aria-label="Trace list">
            <thead>
              <tr>
                <th style={{ width: 80 }} scope="col">status</th>
                <th scope="col">provider · model</th>
                <th scope="col">input preview</th>
                <th className="num" style={{ width: 90 }} scope="col">latency</th>
                <th className="num" style={{ width: 120 }} scope="col">tokens p/c</th>
                <th className="num" style={{ width: 90 }} scope="col">cost</th>
                <th className="num" style={{ width: 80 }} scope="col">when</th>
                <th style={{ width: 200 }} scope="col">
                  <span className="sr-only">actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <TraceRow
                  key={row.id}
                  row={row}
                  isNew={flashIds.has(row.id)}
                  onClick={() => setSelectedId(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Trace drawer */}
      {selectedTrace && (
        <TraceDrawer
          trace={selectedTrace}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
