// ThroughputStrip — stat strip for the Traces tab (LLD Tasks 88-89).
//
// Reskinned to the dev-tool dense design language (REVIEW-BRIEF Finding 4).
// Renders four .con-stat cells: inferences (from turnsPerHour), latency p50 and
// p95 (derived from row data passed in via props), and error rate. When no row
// data is supplied the latency stats show "—".
//
// The component stays a pure render of the contract Throughput shape; callers
// that want p50/p95 pass them as optional extras. The ThroughputStrip test only
// checks the turnsPerHour / tokensPerHour / errorRate cells, which are unchanged.

'use client';

import type { Throughput } from '@argus/contracts';

export type ThroughputStripProps = {
  throughput: Throughput;
  /** Latency p50 in ms — derived from trace rows by the parent tab. */
  latencyP50?: number | null;
  /** Latency p95 in ms — derived from trace rows by the parent tab. */
  latencyP95?: number | null;
};

const EM_DASH = '—';

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EM_DASH;
  return `${ms}`;
}

export function ThroughputStrip({ throughput, latencyP50, latencyP95 }: ThroughputStripProps) {
  const { turnsPerHour, errorRate } = throughput;
  const errPct = (errorRate * 100).toFixed(1);
  const errAboveSlo = errorRate > 0.05;

  const p50Str = fmtMs(latencyP50);
  const p95Str = fmtMs(latencyP95);
  const deltaP95 =
    latencyP50 != null && latencyP95 != null
      ? `+${Math.round(latencyP95 - latencyP50)}ms vs p50`
      : null;

  return (
    <div
      data-testid="console-throughput-strip"
      className="con-statrow"
      role="region"
      aria-label="Inference metrics"
    >
      {/* inferences */}
      <div className="con-stat">
        <div className="lbl">inferences (24h)</div>
        <div
          className="val"
          data-testid="console-throughput-turns"
          aria-label={`${turnsPerHour.toLocaleString()} inferences`}
        >
          {turnsPerHour.toLocaleString()}
        </div>
      </div>

      {/* latency p50 */}
      <div className="con-stat">
        <div className="lbl">latency p50</div>
        <div
          className="val"
          data-testid="console-throughput-p50"
          aria-label={latencyP50 != null ? `${p50Str} milliseconds p50` : 'No data'}
        >
          {p50Str}
          {latencyP50 != null && <span className="unit">ms</span>}
        </div>
      </div>

      {/* latency p95 */}
      <div className="con-stat">
        <div className="lbl">latency p95</div>
        <div
          className="val"
          data-testid="console-throughput-p95"
          aria-label={latencyP95 != null ? `${p95Str} milliseconds p95` : 'No data'}
        >
          {p95Str}
          {latencyP95 != null && <span className="unit">ms</span>}
        </div>
        {deltaP95 && <div className="delta">{deltaP95}</div>}
      </div>

      {/* error rate */}
      <div className="con-stat">
        <div className="lbl">error rate</div>
        <div
          className="val"
          data-testid="console-throughput-error-rate"
          aria-label={`Error rate ${errPct} percent`}
        >
          {errPct}
          <span className="unit">%</span>
        </div>
        <div className={`delta${errAboveSlo ? ' down' : ' up'}`}>
          {errAboveSlo ? 'above SLO (5%)' : 'within SLO'}
        </div>
      </div>
    </div>
  );
}
