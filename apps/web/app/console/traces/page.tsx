// /console/traces — server page (LLD Task 172).
//
// Awaits searchParams (Next 15 async API), decodes the filter + window, fetches
// the initial slice server-side with the session cookie forwarded, and hands it
// to the client <TracesTab> (which then refetches live). The initial fetch is
// best-effort: a transient failure renders an empty slice rather than crashing
// the page — the client tab retries on the next live tick / user action.

import { Suspense } from 'react';

import { TimeWindowSchema, type TimeWindow, type TraceListResponse } from '@argus/contracts';
import { sessionCookieHeader } from '@/lib/server-session';
import { fetchTracesServer } from '@/lib/console-api.server';
import { decodeTracesFilter } from '@/lib/traces-filter-encoding';
import { recordToSearchParams } from '@/lib/console-query';
import { TracesTab } from '@/components/console/traces/TracesTab';

const EMPTY: TraceListResponse = {
  rows: [],
  throughput: { turnsPerHour: 0, tokensPerHour: 0, errorRate: 0 },
  next_cursor: null,
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = recordToSearchParams(await searchParams);
  const filter = decodeTracesFilter(params);
  const parsedWindow = TimeWindowSchema.safeParse(params.get('window'));
  const window: TimeWindow = parsedWindow.success ? parsedWindow.data : '24h';
  const cursor = params.get('cursor') ?? undefined;

  let data = EMPTY;
  try {
    data = await fetchTracesServer({ window, filter, cursor }, await sessionCookieHeader());
  } catch {
    // best-effort initial render; client tab refetches.
  }

  return (
    <Suspense>
      <TracesTab initialData={data} initialWindow={window} initialSearchParams={params} />
    </Suspense>
  );
}
