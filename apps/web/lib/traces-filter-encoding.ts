// traces-filter-encoding — pure, reversible codec between the Traces filter
// UI state and URLSearchParams (LLD frontend-web Phase 4, Tasks 54-57).
//
// Deep links must work: the Traces page decodes filters from `searchParams`
// server-side (page.tsx) and the tab re-encodes them into the URL on change,
// so `encode`/`decode` must round-trip exactly and emit a deterministic key
// order. Multi-value filters (provider / model / status / conversation) are
// the design (see the *MultiSelect controls), so they serialize as REPEATED
// query keys — e.g. `status=ok&status=failed` — matching the contract's
// `TracesQuerySchema` key names so the api can `.getAll()` them.
//
// Note: `window` and `cursor` are NOT part of the filter object — they are
// owned by the TimeWindowToggle and pagination respectively and live as their
// own query params. `decode` deliberately ignores them (and any other unknown
// key) so a deep link carrying them does not poison the filter.

import type { InferenceStatus } from '@argus/contracts';

export type TracesFilter = {
  provider: string[];
  model: string[];
  status: InferenceStatus[];
  conversationId: string[];
  search: string;
};

/** The canonical empty filter — a fresh object each call (never share a
 *  mutable reference between callers). */
export function emptyTracesFilter(): TracesFilter {
  return { provider: [], model: [], status: [], conversationId: [], search: '' };
}

// Fixed serialization order — committed to (not alphabetical) so the encoded
// string is byte-stable and diff-friendly across renders.
const MULTI_KEYS = ['provider', 'model', 'status', 'conversationId'] as const;
type MultiKey = (typeof MULTI_KEYS)[number];

/** Filter -> URLSearchParams. Empty arrays / empty search produce no params. */
export function encodeTracesFilter(filter: TracesFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of MULTI_KEYS) {
    for (const value of filter[key]) {
      params.append(key, value);
    }
  }
  if (filter.search.length > 0) {
    params.append('search', filter.search);
  }
  return params;
}

/** URLSearchParams -> Filter. Unknown keys (window, cursor, anything else)
 *  are dropped silently; known multi-value keys collect every repeat. */
export function decodeTracesFilter(params: URLSearchParams): TracesFilter {
  const filter = emptyTracesFilter();
  for (const key of MULTI_KEYS) {
    const values = params.getAll(key);
    if (values.length > 0) {
      // `status` narrows to InferenceStatus[]; other keys are plain strings.
      (filter[key] as string[]) = values;
    }
  }
  const search = params.get('search');
  if (search !== null) {
    filter.search = search;
  }
  return filter;
}

/** Convenience type-guard helpers exported for the filter bar. */
export type MultiSelectFilterKey = MultiKey;
export const MULTI_SELECT_FILTER_KEYS: readonly MultiSelectFilterKey[] = MULTI_KEYS;
