// CostTable — grouped cost rows (LLD Tasks 136-143).
//
// Each group renders as a clickable row (a real <button> for a11y) with
// prompt / completion / total columns formatted via the shared rule. A group
// with unpriced rows mounts the UnpricedBadge; a mock-provider group is
// visually distinct and carries a screen-reader annotation + data attribute.
// Clicking a row invokes the drilldown handler with that group.
//
// NOTE (contract reconciliation): CostGroupSchema exposes `unpricedCount` (a
// number) but no per-group row total and no explicit mock flag — so "mock" is
// detected from the group key (the provider-grouping case, where key === 'mock')
// and the per-group unpriced model list reuses the response-level
// `unpriced_models`. Flagged for a possible follow-up contract field.

'use client';

import type { CostGroup } from '@argus/contracts';
import { formatMicroUsd } from '@/lib/format-cost';
import { UnpricedBadge } from './UnpricedBadge';

export type CostTableProps = {
  groups: CostGroup[];
  /** Response-level unpriced model list, shown in each row's badge popover. */
  unpricedModels: string[];
  onDrilldown: (group: CostGroup) => void;
};

function isMockGroup(group: CostGroup): boolean {
  // Reliable only for provider grouping (key === provider id). A label-based
  // check would misclassify a conversation literally titled "mock".
  return group.key === 'mock';
}

export function CostTable({ groups, unpricedModels, onDrilldown }: CostTableProps) {
  return (
    <div data-testid="console-cost-table" role="table" aria-label="Cost by group">
      <div
        role="row"
        className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-b border-chat-rule px-3 py-2 text-[11px] uppercase tracking-wide text-chat-ink-3"
      >
        <span role="columnheader">Group</span>
        <span role="columnheader" className="text-right">Prompt</span>
        <span role="columnheader" className="text-right">Completion</span>
        <span role="columnheader" className="text-right">Total</span>
      </div>
      {groups.map((group) => {
        const mock = isMockGroup(group);
        return (
          <div
            key={group.key}
            role="row"
            data-testid={`console-cost-row-${group.key}`}
            data-mock={mock ? 'true' : undefined}
            className={`grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-b border-chat-rule px-3 py-2 text-[12.5px] ${
              mock ? 'italic text-chat-ink-2' : 'text-chat-ink'
            }`}
          >
            <span role="cell" className="flex items-center gap-2 truncate">
              {/* Drilldown is the only interactive control in the row — keeps
                  the UnpricedBadge button from nesting inside another button. */}
              <button
                type="button"
                data-testid={`console-cost-row-${group.key}-select`}
                aria-label={`Drill into ${group.label}`}
                onClick={() => onDrilldown(group)}
                className="truncate text-left underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
              >
                {group.label}
              </button>
              {mock && (
                <span data-testid={`console-cost-row-${group.key}-mock`} className="text-[11px] text-chat-ink-3">
                  <span className="sr-only">(mock provider)</span>
                  <span aria-hidden="true">mock</span>
                </span>
              )}
              {group.unpricedCount > 0 && (
                <UnpricedBadge count={group.unpricedCount} models={unpricedModels} />
              )}
            </span>
            <span role="cell" className="text-right tabular-nums">
              {formatMicroUsd(group.promptCostMicros)}
            </span>
            <span role="cell" className="text-right tabular-nums">
              {formatMicroUsd(group.completionCostMicros)}
            </span>
            <span role="cell" className="text-right font-medium tabular-nums">
              {formatMicroUsd(group.totalCostMicros)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
