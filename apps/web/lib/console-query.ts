// console-query — pure query-string builders for the console read endpoints.
//
// Lives apart from the fetch helpers so BOTH the server (`console-api.server`)
// and browser (`console-api.client`) variants build identical query strings
// without either pulling in the other's fetch layer (`server-only` must not
// leak into client bundles — see the LLD's module-boundary Reviewer Concern).
// No fetch / no server-only imports here — just URLSearchParams assembly.

import type { CostGroupBy, TimeWindow } from '@argus/contracts';
import { encodeTracesFilter, type TracesFilter } from './traces-filter-encoding';

export type TracesQueryArgs = {
  window: TimeWindow;
  filter: TracesFilter;
  cursor?: string;
  limit?: number;
};

/** Filter (repeated multi-value keys) + window + cursor + limit, in a fixed
 *  order so the URL is stable. */
export function buildTracesQuery(args: TracesQueryArgs): URLSearchParams {
  const params = encodeTracesFilter(args.filter);
  params.set('window', args.window);
  if (args.cursor) params.set('cursor', args.cursor);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  return params;
}

export type CostQueryArgs = {
  window: TimeWindow;
  groupBy: CostGroupBy;
  includeSample?: boolean;
  includeReplay?: boolean;
  includeMock?: boolean;
};

export function buildCostQuery(args: CostQueryArgs): URLSearchParams {
  const params = new URLSearchParams();
  params.set('window', args.window);
  params.set('groupBy', args.groupBy);
  if (args.includeSample !== undefined) params.set('includeSample', String(args.includeSample));
  if (args.includeReplay !== undefined) params.set('includeReplay', String(args.includeReplay));
  if (args.includeMock !== undefined) params.set('includeMock', String(args.includeMock));
  return params;
}

export type ReplayCandidatesQueryArgs = {
  window: TimeWindow;
  cursor?: string;
  limit?: number;
};

export function buildReplayCandidatesQuery(
  args: ReplayCandidatesQueryArgs,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('window', args.window);
  if (args.cursor) params.set('cursor', args.cursor);
  if (args.limit !== undefined) params.set('limit', String(args.limit));
  return params;
}

/** `path?query` only when the query is non-empty. */
export function withQuery(path: string, params: URLSearchParams): string {
  const q = params.toString();
  return q.length > 0 ? `${path}?${q}` : path;
}

/**
 * Convert Next 15's awaited `searchParams` record (`string | string[] |
 * undefined` values) into a URLSearchParams, preserving repeated multi-value
 * keys. Used by the server pages to feed the filter/window decoders.
 */
export function recordToSearchParams(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  return params;
}
