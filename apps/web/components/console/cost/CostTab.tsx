// CostTab — orchestrates the Cost tab (LLD Tasks 144-149 + Task 176 shell).
//
// Reskinned to the dense dev-tool design language (REVIEW-BRIEF Finding 4).
// Layout contract: fragment rooted in con-statrow → con-tools → cost-grid.
// The component retains all original data-fetching, URL-sync, drilldown, and
// live-tick behaviour; only the visual chrome changes.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import {
  CostGroupBySchema,
  type CostGroup,
  type CostGroupBy,
  type CostResponse,
  type SparklinePoint,
  type TimeWindow,
} from '@argus/contracts';
import { fetchCost, generateSample } from '@/lib/console-api';
import { useConsoleLive } from '@/lib/use-console-live';
import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import type { CostQueryArgs } from '@/lib/console-query';
import { formatMicroUsd } from '@/lib/format-cost';

import { Icon } from '../Icon';
import { EmptyState } from '../EmptyState';
import { Sparkline } from './Sparkline';
import { CostTable } from './CostTable';

export type CostTabProps = {
  initialData: CostResponse;
  initialWindow?: TimeWindow;
  /** Initial group-by, resolved server-side from the URL. Plain values (not a
   *  URLSearchParams) so they survive the Server→Client prop boundary. */
  initialGroupBy?: CostGroupBy;
  refetchDebounceMs?: number;
};

const GROUP_BY_LABELS: Record<CostGroupBy, string> = {
  conversation: 'conversation',
  provider: 'provider',
  model: 'model',
};

const WINDOW_LABELS: Record<TimeWindow, string> = {
  '24h': '24h',
  '7d': '7d',
  all: 'all-time',
};

/** Derive stat-strip metrics from the response data. */
function deriveStats(data: CostResponse): {
  totalMicros: number;
  inferenceCount: number;
  avgCostMicros: number;
  topModel: string | null;
  topModelTotalMicros: number;
  pricingSnapshotNote: string;
} {
  const pricedGroups = data.groups.filter((g) => g.totalCostMicros > 0);
  // Best-effort avg: total / number of groups with non-zero cost (groups are
  // the smallest unit the API exposes — no per-inference count in CostGroup).
  const avgCostMicros =
    pricedGroups.length > 0
      ? Math.round(data.total_micro_usd / pricedGroups.length)
      : 0;

  const sorted = [...data.groups].sort((a, b) => b.totalCostMicros - a.totalCostMicros);
  const top = sorted[0] ?? null;

  return {
    totalMicros: data.total_micro_usd,
    inferenceCount: data.groups.reduce((s, g) => s + (1 + g.unpricedCount), 0),
    avgCostMicros,
    topModel: top?.label ?? null,
    topModelTotalMicros: top?.totalCostMicros ?? 0,
    pricingSnapshotNote: 'priced against snapshot 2026-05-23',
  };
}

export function CostTab({
  initialData,
  initialWindow = '24h',
  initialGroupBy = 'conversation',
  refetchDebounceMs = 300,
}: CostTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { subscribe } = useConsoleLive();

  const [data, setData] = useState<CostResponse>(initialData);
  const [windowValue, setWindowValue] = useState<TimeWindow>(initialWindow);
  const [groupBy, setGroupBy] = useState<CostGroupBy>(initialGroupBy);
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

  const stats = useMemo(() => deriveStats(data), [data]);

  // Sparkline data for chart — hourly buckets from the API.
  const sparklinePoints: SparklinePoint[] = data.sparkline;
  const maxSparklineMicros = useMemo(
    () => Math.max(1, ...sparklinePoints.map((p) => p.costMicros)),
    [sparklinePoints],
  );

  const chartTitle =
    windowValue === '24h'
      ? 'spend per hour · last 24h'
      : windowValue === '7d'
        ? 'spend per hour · last 7d'
        : 'spend per hour · all time';

  return (
    <div data-testid="console-cost-tab">
      <h1 className="sr-only">Cost</h1>

      {/* ── Stat strip ─────────────────────────────────────────────────── */}
      <div className="con-statrow" role="region" aria-label="Cost statistics">
        <div className="con-stat">
          <div className="lbl">spend ({windowValue})</div>
          <div className="val" data-testid="console-cost-total">
            {formatMicroUsd(stats.totalMicros)}
            <span className="unit">usd</span>
          </div>
          <div className="delta">{stats.pricingSnapshotNote}</div>
          {/* Sparkline — only renders the path when data exists (testid=console-sparkline-path) */}
          <div className="spark">
            <Sparkline
              values={sparklinePoints.map((p) => p.costMicros)}
              width={160}
              height={22}
              ariaLabel="Cost trend sparkline"
            />
          </div>
        </div>
        <div className="con-stat">
          <div className="lbl">inferences</div>
          <div className="val">{stats.inferenceCount}</div>
          <div className="delta">mock contributes $0</div>
        </div>
        <div className="con-stat">
          <div className="lbl">avg cost / call</div>
          <div className="val">{formatMicroUsd(stats.avgCostMicros)}</div>
        </div>
        <div className="con-stat">
          <div className="lbl">most expensive model</div>
          <div
            className="val"
            style={{ fontSize: 14, fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}
          >
            {stats.topModel ?? '—'}
          </div>
          {stats.topModel && (
            <div className="delta">{formatMicroUsd(stats.topModelTotalMicros)}</div>
          )}
        </div>
      </div>

      {/* ── Tools / filter bar ──────────────────────────────────────────── */}
      <div className="con-tools" role="toolbar" aria-label="Cost filters">
        {/* Group-by chips — carry the same testids the tests target. */}
        {CostGroupBySchema.options.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`console-cost-groupby-${option}`}
            aria-pressed={groupBy === option}
            aria-label={`Group by ${GROUP_BY_LABELS[option]}`}
            onClick={() => handleGroupByChange(option)}
            className={`filter-chip${groupBy === option ? ' active' : ''}`}
          >
            <Icon name="filter" size={10} aria-hidden="true" />
            {`group: ${GROUP_BY_LABELS[option]}`}
          </button>
        ))}

        {/* Include-sample / include-replay toggles (preserved from original) */}
        <button
          type="button"
          data-testid="console-cost-include-sample"
          aria-pressed={includeSample}
          aria-label={`${includeSample ? 'Exclude' : 'Include'} sample inferences`}
          onClick={() => handleIncludeSample(!includeSample)}
          className={`filter-chip${includeSample ? ' active' : ''}`}
        >
          sample
        </button>
        <button
          type="button"
          data-testid="console-cost-include-replay"
          aria-pressed={includeReplay}
          aria-label={`${includeReplay ? 'Exclude' : 'Include'} replay inferences`}
          onClick={() => handleIncludeReplay(!includeReplay)}
          className={`filter-chip${includeReplay ? ' active' : ''}`}
        >
          replay
        </button>

        <div className="spacer" />

        {/* Window switch */}
        <div
          className="window-switch"
          role="group"
          aria-label="Time window"
          data-testid="console-time-window-toggle"
        >
          {(['24h', '7d', 'all'] as const).map((w) => (
            <button
              key={w}
              type="button"
              data-testid={`console-time-window-${w}`}
              aria-pressed={windowValue === w}
              aria-label={`Show ${WINDOW_LABELS[w]}`}
              onClick={() => handleWindowChange(w)}
              className={windowValue === w ? 'active' : ''}
            >
              {WINDOW_LABELS[w]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cost grid ───────────────────────────────────────────────────── */}
      <div className="cost-grid">
        {/* Left pane: hourly spend chart (sparkline buckets) */}
        <div className="cost-pane">
          <div className="ph">
            <h3>{chartTitle}</h3>
            <div className="lgnd" aria-label="Chart legend">
              {/* API sparkline has no per-provider split — single color */}
              <span>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    background: 'var(--acc)',
                    marginRight: 4,
                    borderRadius: 2,
                  }}
                />
                total spend
              </span>
            </div>
          </div>
          <div
            className="cost-chart"
            data-testid="console-cost-chart"
            role="img"
            aria-label={`${chartTitle} bar chart`}
          >
            {sparklinePoints.length > 0 ? (
              <>
                <div
                  className="cost-bars"
                  style={{
                    // Dynamic column count to match actual data points
                    gridTemplateColumns: `repeat(${sparklinePoints.length}, 1fr)`,
                  }}
                >
                  {sparklinePoints.map((point, i) => {
                    const pct = Math.max(
                      2,
                      (point.costMicros / maxSparklineMicros) * 100,
                    );
                    const label = new Date(point.hourStart).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      hour12: false,
                    });
                    return (
                      <div
                        key={point.hourStart}
                        className="cost-bar"
                        data-testid={`console-cost-bar-${i}`}
                        title={`${label} · ${formatMicroUsd(point.costMicros)}`}
                        aria-label={`${label}: ${formatMicroUsd(point.costMicros)}`}
                      >
                        {/* Single segment — API has no per-provider hourly breakdown */}
                        <span
                          style={{
                            height: `${pct}%`,
                            minHeight: point.costMicros > 0 ? 2 : 0,
                            background: 'var(--acc)',
                            width: '100%',
                            display: point.costMicros > 0 ? 'block' : 'none',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div
                  className="cost-axis"
                  style={{
                    gridTemplateColumns: `repeat(${sparklinePoints.length}, 1fr)`,
                  }}
                >
                  {sparklinePoints.map((point, i) => {
                    const h = new Date(point.hourStart).getUTCHours();
                    return (
                      <span key={point.hourStart} aria-hidden={i % 6 !== 0 ? 'true' : undefined}>
                        {h}h
                      </span>
                    );
                  })}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--con-dim-2)',
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  fontSize: 11,
                }}
              >
                no hourly data for this window
              </div>
            )}
          </div>
        </div>

        {/* Right pane: breakdown table */}
        <div className="cost-pane">
          <div className="ph">
            <h3>by {GROUP_BY_LABELS[groupBy]}</h3>
            <div className="lgnd">prompt · completion · total</div>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
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
        </div>
      </div>
    </div>
  );
}
