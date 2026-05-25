// ThroughputStrip — the header metrics on the Traces feed (LLD Tasks 88-89).
//
// Pure render of the contract `Throughput` shape: turns/hour, tokens/hour
// (locale-formatted), and the error rate as a percentage.

'use client';

import type { Throughput } from '@argus/contracts';

export type ThroughputStripProps = {
  throughput: Throughput;
};

export function ThroughputStrip({ throughput }: ThroughputStripProps) {
  const { turnsPerHour, tokensPerHour, errorRate } = throughput;
  return (
    <dl
      data-testid="console-throughput-strip"
      className="flex flex-wrap items-center gap-6 rounded-md border border-chat-rule bg-chat-panel px-4 py-3"
    >
      <div className="flex flex-col">
        <dt className="text-[11px] uppercase tracking-wide text-chat-ink-3">Turns / hour</dt>
        <dd data-testid="console-throughput-turns" className="text-sm font-medium text-chat-ink">
          {turnsPerHour.toLocaleString()}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-[11px] uppercase tracking-wide text-chat-ink-3">Tokens / hour</dt>
        <dd data-testid="console-throughput-tokens" className="text-sm font-medium text-chat-ink">
          {tokensPerHour.toLocaleString()}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-[11px] uppercase tracking-wide text-chat-ink-3">Error rate</dt>
        <dd data-testid="console-throughput-error-rate" className="text-sm font-medium text-chat-ink">
          {(errorRate * 100).toFixed(1)}%
        </dd>
      </div>
    </dl>
  );
}
