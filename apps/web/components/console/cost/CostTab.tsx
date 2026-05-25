// CostTab — orchestrates the Cost tab (LLD Tasks 144-149 + Task 176 shell).
//
// Owns window / group-by / include-sample / include-replay state, refetches on
// any control change (and on a debounced live tick), derives the sparkline
// series from the latest response, and drills a row down into a filtered
// Traces view. Window + group-by are mirrored into the URL for deep links.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  CostGroupBySchema,
  TimeWindowSchema,
  type CostGroup,
  type CostGroupBy,
  type CostResponse,
  type TimeWindow,
} from '@argus/contracts';
import { fetchCost, generateSample } from '@/lib/console-api';
import { useConsoleLive } from '@/lib/use-console-live';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import type { CostQueryArgs } from '@/lib/console-query';

import { TimeWindowToggle } from '../TimeWindowToggle';
import { EmptyState } from '../EmptyState';
import { CostHeader } from './CostHeader';
import { CostTable } from './CostTable';

export type CostTabProps = {
  initialData: CostResponse;
  initialWindow?: TimeWindow;
  initialSearchParams?: URLSearchParams;
  refetchDebounceMs?: number;
};

function readWindow(params: URLSearchParams | undefined, fallback: TimeWindow): TimeWindow {
  const parsed = TimeWindowSchema.safeParse(params?.get('window'));
  return parsed.success ? parsed.data : fallback;
}
function readGroupBy(params: URLSearchParams | undefined): CostGroupBy {
  const parsed = CostGroupBySchema.safeParse(params?.get('groupBy'));
  return parsed.success ? parsed.data : 'conversation';
}

export function CostTab({
  initialData,
  initialWindow = '24h',
  initialSearchParams,
  refetchDebounceMs = 300,
}: CostTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { subscribe } = useConsoleLive();

  const [data, setData] = useState<CostResponse>(initialData);
  const [windowValue, setWindowValue] = useState<TimeWindow>(
    readWindow(initialSearchParams, initialWindow),
  );
  const [groupBy, setGroupBy] = useState<CostGroupBy>(readGroupBy(initialSearchParams));
  const [includeSample, setIncludeSample] = useState(true);
  const [includeReplay, setIncludeReplay] = useState(true);

  const buildArgs = useCallback(
    (overrides: Partial<CostQueryArgs> = {}): CostQueryArgs => ({
      window: windowValue,
      groupBy,
      includeSample,
      includeReplay,
      ...overrides,
    }),
    [windowValue, groupBy, includeSample, includeReplay],
  );

  const refetch = useCallback(async (args: CostQueryArgs) => {
    try {
      setData(await fetchCost(args));
    } catch {
      // Keep last good data on transient failure.
    }
  }, []);

  const argsRef = useRef(buildArgs());
  argsRef.current = buildArgs();
  const debouncedRefetch = useDebouncedCallback(
    () => void refetch(argsRef.current),
    refetchDebounceMs,
  );

  const pushUrl = useCallback(
    (w: TimeWindow, g: CostGroupBy) => {
      const params = new URLSearchParams();
      params.set('window', w);
      params.set('groupBy', g);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname],
  );

  const handleWindowChange = (next: TimeWindow) => {
    setWindowValue(next);
    pushUrl(next, groupBy);
    void refetch(buildArgs({ window: next }));
  };
  const handleGroupByChange = (next: CostGroupBy) => {
    setGroupBy(next);
    pushUrl(windowValue, next);
    void refetch(buildArgs({ groupBy: next }));
  };
  const handleIncludeSample = (next: boolean) => {
    setIncludeSample(next);
    void refetch(buildArgs({ includeSample: next }));
  };
  const handleIncludeReplay = (next: boolean) => {
    setIncludeReplay(next);
    void refetch(buildArgs({ includeReplay: next }));
  };

  // Live tick → debounced refetch.
  useEffect(() => {
    const unsubscribe = subscribe(
      () => true,
      () => debouncedRefetch(),
    );
    return unsubscribe;
  }, [subscribe, debouncedRefetch]);

  const sparkline = data.sparkline.map((point) => point.costMicros);

  const handleGenerateSamples = async () => {
    try {
      await generateSample();
    } finally {
      void refetch(argsRef.current);
    }
  };

  const handleDrilldown = (group: CostGroup) => {
    const key = encodeURIComponent(group.key);
    const param =
      groupBy === 'conversation'
        ? `conversationId=${key}`
        : groupBy === 'provider'
          ? `provider=${key}`
          : `model=${key}`;
    router.push(`/console/traces?${param}`);
  };

  return (
    <div data-testid="console-cost-tab" className="flex flex-col gap-4">
      <h1 className="sr-only">Cost</h1>
      <div className="flex flex-wrap items-center gap-3">
        <TimeWindowToggle value={windowValue} onChange={handleWindowChange} />
        <label className="flex items-center gap-1.5 text-[12.5px] text-chat-ink-2">
          <input
            type="checkbox"
            data-testid="console-cost-include-sample"
            checked={includeSample}
            onChange={(e) => handleIncludeSample(e.target.checked)}
            className="accent-acc focus-visible:ring-2 focus-visible:ring-acc"
          />
          Include sample
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-chat-ink-2">
          <input
            type="checkbox"
            data-testid="console-cost-include-replay"
            checked={includeReplay}
            onChange={(e) => handleIncludeReplay(e.target.checked)}
            className="accent-acc focus-visible:ring-2 focus-visible:ring-acc"
          />
          Include replay
        </label>
      </div>

      <CostHeader
        totalMicroUsd={data.total_micro_usd}
        sparkline={sparkline}
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
      />

      {data.groups.length === 0 ? (
        <EmptyState scope="cost" onGenerateSamples={handleGenerateSamples} />
      ) : (
        <CostTable
          groups={data.groups}
          unpricedModels={data.unpriced_models}
          onDrilldown={handleDrilldown}
        />
      )}
    </div>
  );
}
