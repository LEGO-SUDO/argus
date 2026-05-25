// console-api.server — server-side typed REST helpers for the `/console`
// control plane (LLD frontend-web Phase 3, Task 49).
//
// SERVER-ONLY: the `import 'server-only'` makes it a build error if a client
// component pulls this in. The `/console` pages call these from their async
// server components to do the INITIAL fetch (with the request's session cookie
// forwarded), then hand the data to the client tab, which refetches live via
// the browser helpers in `console-api.client.ts`.
//
// Server requests bypass the Next rewrite, so these dial the api's BARE
// `/console/...` and `/providers/availability` paths via `serverApiFetch`
// (CONTRACTS.md §URL convention). Responses are schema-validated; AuthError /
// ApiError propagate unwrapped.

import 'server-only';

import { serverApiFetch } from './server-api-fetch';
import {
  TraceListResponseSchema,
  CostResponseSchema,
  ReplayCandidatesResponseSchema,
  ReplayDetailSchema,
  ProviderAvailabilityResponseSchema,
  type TraceListResponse,
  type CostResponse,
  type ReplayCandidatesResponse,
  type ReplayDetail,
  type ProviderAvailabilityResponse,
} from '@argus/contracts';
import {
  buildTracesQuery,
  buildCostQuery,
  buildReplayCandidatesQuery,
  withQuery,
  type TracesQueryArgs,
  type CostQueryArgs,
  type ReplayCandidatesQueryArgs,
} from './console-query';

export async function fetchTracesServer(
  args: TracesQueryArgs,
  cookieHeader: string,
): Promise<TraceListResponse> {
  const raw = await serverApiFetch<unknown>(
    withQuery('/console/traces', buildTracesQuery(args)),
    { cookieHeader },
  );
  return TraceListResponseSchema.parse(raw);
}

export async function fetchCostServer(
  args: CostQueryArgs,
  cookieHeader: string,
): Promise<CostResponse> {
  const raw = await serverApiFetch<unknown>(
    withQuery('/console/cost', buildCostQuery(args)),
    { cookieHeader },
  );
  return CostResponseSchema.parse(raw);
}

export async function fetchReplayCandidatesServer(
  args: ReplayCandidatesQueryArgs,
  cookieHeader: string,
): Promise<ReplayCandidatesResponse> {
  const raw = await serverApiFetch<unknown>(
    withQuery('/console/replay/candidates', buildReplayCandidatesQuery(args)),
    { cookieHeader },
  );
  return ReplayCandidatesResponseSchema.parse(raw);
}

export async function fetchReplayDetailServer(
  inferenceId: string,
  cookieHeader: string,
): Promise<ReplayDetail> {
  const raw = await serverApiFetch<unknown>(
    `/console/replay/${encodeURIComponent(inferenceId)}`,
    { cookieHeader },
  );
  return ReplayDetailSchema.parse(raw);
}

export async function fetchProviderAvailabilityServer(
  cookieHeader: string,
): Promise<ProviderAvailabilityResponse> {
  const raw = await serverApiFetch<unknown>('/providers/availability', { cookieHeader });
  return ProviderAvailabilityResponseSchema.parse(raw);
}
