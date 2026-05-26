// /console/replay — server page (LLD Task 174).
//
// Awaits searchParams, reads the optional ?sourceId=<inferenceId> + window. With
// a source it fetches the replay detail; otherwise it fetches the candidate
// list. The provider/model catalog is always fetched (the picker reads its
// models from the availability snapshot — never hardcoded). All initial
// fetches are best-effort.

import {
  TimeWindowSchema,
  type ProviderAvailabilityResponse,
  type ReplayCandidate,
  type ReplayDetail,
  type TimeWindow,
} from '@argus/contracts';
import { sessionCookieHeader } from '@/lib/server-session';
import {
  fetchReplayCandidatesServer,
  fetchReplayDetailServer,
  fetchProviderAvailabilityServer,
} from '@/lib/console-api.server';
import { recordToSearchParams } from '@/lib/console-query';
import { ReplayTab } from '@/components/console/replay/ReplayTab';

const EMPTY_AVAILABILITY: ProviderAvailabilityResponse = { providers: [], snapshotDate: '' };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = recordToSearchParams(await searchParams);
  const parsedWindow = TimeWindowSchema.safeParse(params.get('window'));
  const window: TimeWindow = parsedWindow.success ? parsedWindow.data : '24h';
  // The trace-drawer deep link uses ?sourceId=<id> (TraceDrawer.handleReplay);
  // accept legacy ?source= as a fallback. Either pre-selects the comparison
  // view server-side so a click-through OR a refresh lands on the source, not
  // the candidate picker.
  const source = params.get('sourceId') ?? params.get('source') ?? undefined;
  const cookieHeader = await sessionCookieHeader();

  let availability = EMPTY_AVAILABILITY;
  try {
    availability = await fetchProviderAvailabilityServer(cookieHeader);
  } catch {
    // best-effort.
  }

  let candidates: ReplayCandidate[] = [];
  let initialDetail: ReplayDetail | undefined;
  if (source) {
    try {
      initialDetail = await fetchReplayDetailServer(source, cookieHeader);
    } catch {
      // best-effort; fall back to the picker.
    }
  } else {
    try {
      const result = await fetchReplayCandidatesServer({ window }, cookieHeader);
      candidates = result.candidates;
    } catch {
      // best-effort.
    }
  }

  return (
    <ReplayTab
      candidates={candidates}
      initialDetail={initialDetail}
      availability={availability}
      window={window}
    />
  );
}
