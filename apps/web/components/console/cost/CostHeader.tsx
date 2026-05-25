// CostHeader — total spend + sparkline + regroup toggle (LLD Tasks 128-133).
//
// Total spend is rounded once via the shared formatMicroUsd rule (sub-cent ->
// "< $0.01", true zero -> "$0.00"). The regroup toggle emits the chosen
// group-by; the parent tab owns the value and refetches.

'use client';

import { CostGroupBySchema, type CostGroupBy } from '@argus/contracts';
import { formatMicroUsd } from '@/lib/format-cost';
import { Sparkline } from './Sparkline';

const GROUP_BY_LABELS: Record<CostGroupBy, string> = {
  conversation: 'Conversation',
  provider: 'Provider',
  model: 'Model',
};

export type CostHeaderProps = {
  totalMicroUsd: number;
  /** Cost-per-hour series (micro-USD) derived from the response sparkline. */
  sparkline: number[];
  groupBy: CostGroupBy;
  onGroupByChange: (groupBy: CostGroupBy) => void;
};

export function CostHeader({
  totalMicroUsd,
  sparkline,
  groupBy,
  onGroupByChange,
}: CostHeaderProps) {
  return (
    <div
      data-testid="console-cost-header"
      className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-chat-rule bg-chat-panel p-4"
    >
      <div className="flex flex-col">
        <span className="text-[11px] uppercase tracking-wide text-chat-ink-3">Total spend</span>
        <span data-testid="console-cost-total" className="text-lg font-semibold text-chat-ink">
          {formatMicroUsd(totalMicroUsd)}
        </span>
      </div>

      <Sparkline values={sparkline} />

      <div
        data-testid="console-cost-groupby"
        role="group"
        aria-label="Group cost by"
        className="inline-flex items-center rounded-[6px] border border-chat-rule bg-chat-bg p-0.5"
      >
        {CostGroupBySchema.options.map((option) => {
          const selected = option === groupBy;
          return (
            <button
              key={option}
              type="button"
              data-testid={`console-cost-groupby-${option}`}
              aria-pressed={selected}
              aria-label={`Group by ${GROUP_BY_LABELS[option]}`}
              onClick={() => onGroupByChange(option)}
              className={`min-h-8 rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
                selected ? 'bg-chat-ink text-chat-bg' : 'text-chat-ink-2 hover:bg-chat-hover'
              }`}
            >
              {GROUP_BY_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
