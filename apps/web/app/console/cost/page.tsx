// /console/cost — server page (LLD Task 173).
//
// Awaits searchParams, reads window + group-by + include-sample/replay flags,
// fetches the initial cost rollup server-side, and hands it to <CostTab>.

import {
  CostGroupBySchema,
  TimeWindowSchema,
  type CostGroupBy,
  type CostResponse,
  type TimeWindow,
} from '@argus/contracts';
import { sessionCookieHeader } from '@/lib/server-session';
import { fetchCostServer } from '@/lib/console-api.server';
import { recordToSearchParams } from '@/lib/console-query';
import { CostTab } from '@/components/console/cost/CostTab';

const EMPTY: CostResponse = {
  groups: [],
  total_micro_usd: 0,
  sparkline: [],
  unpriced_models: [],
};

type SearchParams = Record<string, string | string[] | undefined>;

function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw === 'true' || raw === '1';
}

export default async function CostPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = recordToSearchParams(await searchParams);
  const parsedWindow = TimeWindowSchema.safeParse(params.get('window'));
  const window: TimeWindow = parsedWindow.success ? parsedWindow.data : '24h';
  const parsedGroupBy = CostGroupBySchema.safeParse(params.get('groupBy'));
  const groupBy: CostGroupBy = parsedGroupBy.success ? parsedGroupBy.data : 'conversation';
  const includeSample = flag(params, 'includeSample', true);
  const includeReplay = flag(params, 'includeReplay', true);

  let data = EMPTY;
  try {
    data = await fetchCostServer(
      { window, groupBy, includeSample, includeReplay },
      await sessionCookieHeader(),
    );
  } catch {
    // best-effort initial render.
  }

  return (
    <CostTab initialData={data} initialWindow={window} initialGroupBy={groupBy} />
  );
}
