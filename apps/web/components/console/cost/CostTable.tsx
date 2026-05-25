// CostTable — grouped cost rows (LLD Tasks 136-143).
//
// Reskinned to the dense dev-tool design language (REVIEW-BRIEF Finding 4).
// Uses .brk-table with .ptag provider colour swatches. All data-testid, aria,
// and behavioural contracts from the original are preserved 1:1.
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

/** Derive a provider colour swatch key from a group key.
 *  For provider-grouped rows the key IS the provider id; for model/conversation
 *  grouping we can't know the provider, so we leave data-prov unset (no swatch). */
function swatchProvider(group: CostGroup): string | undefined {
  const known = ['openai', 'anthropic', 'gemini', 'mock'];
  return known.includes(group.key) ? group.key : undefined;
}

export function CostTable({ groups, unpricedModels, onDrilldown }: CostTableProps) {
  return (
    <div data-testid="console-cost-table" role="table" aria-label="Cost by group">
      <table className="brk-table">
        <thead>
          <tr>
            <th role="columnheader">model</th>
            <th role="columnheader" className="num">prompt $</th>
            <th role="columnheader" className="num">completion $</th>
            <th role="columnheader" className="num">total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const mock = isMockGroup(group);
            const prov = swatchProvider(group);
            const unpriced = group.unpricedCount > 0;

            return (
              <tr
                key={group.key}
                role="row"
                data-testid={`console-cost-row-${group.key}`}
                data-mock={mock ? 'true' : undefined}
                style={mock ? { fontStyle: 'italic', color: 'var(--con-dim)' } : undefined}
              >
                {/* Label cell — drilldown button + ptag colour swatch */}
                <td role="cell">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {prov !== undefined ? (
                      <span
                        className="ptag"
                        data-prov={prov}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <span className="swatch" />
                        <button
                          type="button"
                          data-testid={`console-cost-row-${group.key}-select`}
                          aria-label={`Drill into ${group.label}`}
                          onClick={() => onDrilldown(group)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            color: 'inherit',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dashed',
                            textUnderlineOffset: 2,
                          }}
                        >
                          {group.label}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`console-cost-row-${group.key}-select`}
                        aria-label={`Drill into ${group.label}`}
                        onClick={() => onDrilldown(group)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: 'inherit',
                          fontFamily: 'inherit',
                          fontSize: 'inherit',
                          textDecoration: 'underline',
                          textDecorationStyle: 'dashed',
                          textUnderlineOffset: 2,
                        }}
                      >
                        {group.label}
                      </button>
                    )}
                    {mock && (
                      <span
                        data-testid={`console-cost-row-${group.key}-mock`}
                        style={{ fontSize: 10.5, color: 'var(--con-dim-2)' }}
                      >
                        <span className="sr-only">(mock provider)</span>
                        <span aria-hidden="true">mock</span>
                      </span>
                    )}
                    {unpriced && (
                      <UnpricedBadge count={group.unpricedCount} models={unpricedModels} />
                    )}
                  </span>
                </td>

                <td role="cell" className="num">
                  {unpriced && group.promptCostMicros === 0 ? (
                    <span
                      className="dim"
                      title="no pricing entry; contributes zero"
                    >
                      —
                    </span>
                  ) : (
                    formatMicroUsd(group.promptCostMicros)
                  )}
                </td>
                <td role="cell" className="num">
                  {unpriced && group.completionCostMicros === 0 ? (
                    <span className="dim">—</span>
                  ) : (
                    formatMicroUsd(group.completionCostMicros)
                  )}
                </td>
                <td role="cell" className="num">
                  <b style={{ fontWeight: 600 }}>
                    {unpriced && group.totalCostMicros === 0 ? (
                      <span className="dim">—</span>
                    ) : (
                      formatMicroUsd(group.totalCostMicros)
                    )}
                  </b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unpricedModels.length > 0 && (
        <div
          style={{
            padding: '8px 14px',
            color: 'var(--con-dim-2)',
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 10.5,
          }}
        >
          {"'—' = no pricing entry; contributes zero to totals."}
        </div>
      )}
    </div>
  );
}
