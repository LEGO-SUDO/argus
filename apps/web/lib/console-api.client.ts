// console-api.client — browser-side typed REST helpers for the `/console`
// control plane (LLD frontend-web Phase 3).
//
// Browser callers (the client tab components) prefix `/api/...` so the Next
// rewrite proxies to the api; cookies travel via `credentials: 'include'`.
// This module is CLIENT-SAFE: it imports only `auth-fetch`, `@argus/contracts`,
// and the pure query builders — never `server-only`. The `@/lib/console-api`
// barrel re-exports exactly this module so client components can import it
// without dragging `server-only` into their bundle.
//
// Every helper parses the response through the matching `@argus/contracts`
// schema before returning, and lets `AuthError` / `ApiError` from `auth-fetch`
// propagate UNWRAPPED — callers decide UX (Task 52).
//
// URL note: per CONTRACTS.md the canonical bare paths are
// `POST /console/replay/run` and `POST /console/samples/generate`; the browser
// variants below are their `/api/...` mirrors. (The LLD prose's `/api/console/
// replay` and `/api/console/sample` are stale — CONTRACTS.md is binding.)

import { authFetch } from './auth-fetch';
import {
  TraceListResponseSchema,
  CostResponseSchema,
  ReplayCandidatesResponseSchema,
  ReplayDetailSchema,
  ReplayRunResponseSchema,
  SampleGenerateResponseSchema,
  ClearPreviewResponseSchema,
  ClearResponseSchema,
  BadgeLagResponseSchema,
  ProviderAvailabilityResponseSchema,
  type TraceListResponse,
  type CostResponse,
  type ReplayCandidatesResponse,
  type ReplayDetail,
  type ReplayRunRequest,
  type ReplayRunResponse,
  type GenerateSamplesRequest,
  type SampleGenerateResponse,
  type ClearPreviewResponse,
  type ClearResponse,
  type BadgeLagResponse,
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

// --- Reads (browser variants — used by client tabs for live refetch) -------

export async function fetchTraces(args: TracesQueryArgs): Promise<TraceListResponse> {
  const raw = await authFetch<unknown>(
    withQuery('/api/console/traces', buildTracesQuery(args)),
  );
  return TraceListResponseSchema.parse(raw);
}

export async function fetchCost(args: CostQueryArgs): Promise<CostResponse> {
  const raw = await authFetch<unknown>(withQuery('/api/console/cost', buildCostQuery(args)));
  return CostResponseSchema.parse(raw);
}

export async function fetchReplayCandidates(
  args: ReplayCandidatesQueryArgs,
): Promise<ReplayCandidatesResponse> {
  const raw = await authFetch<unknown>(
    withQuery('/api/console/replay/candidates', buildReplayCandidatesQuery(args)),
  );
  return ReplayCandidatesResponseSchema.parse(raw);
}

export async function fetchReplayDetail(inferenceId: string): Promise<ReplayDetail> {
  const raw = await authFetch<unknown>(
    `/api/console/replay/${encodeURIComponent(inferenceId)}`,
  );
  return ReplayDetailSchema.parse(raw);
}

export async function fetchProviderAvailability(): Promise<ProviderAvailabilityResponse> {
  const raw = await authFetch<unknown>('/api/providers/availability');
  return ProviderAvailabilityResponseSchema.parse(raw);
}

export async function fetchBadgeLag(): Promise<BadgeLagResponse> {
  const raw = await authFetch<unknown>('/api/console/live/badge');
  return BadgeLagResponseSchema.parse(raw);
}

// --- Mutations (browser-only) ----------------------------------------------

export async function runReplay(request: ReplayRunRequest): Promise<ReplayRunResponse> {
  const raw = await authFetch<unknown>('/api/console/replay/run', {
    method: 'POST',
    body: request,
  });
  return ReplayRunResponseSchema.parse(raw);
}

export async function generateSample(
  request: GenerateSamplesRequest = {},
): Promise<SampleGenerateResponse> {
  const raw = await authFetch<unknown>('/api/console/samples/generate', {
    method: 'POST',
    body: request,
  });
  return SampleGenerateResponseSchema.parse(raw);
}

export async function previewClear(): Promise<ClearPreviewResponse> {
  const raw = await authFetch<unknown>('/api/console/clear/preview');
  return ClearPreviewResponseSchema.parse(raw);
}

export async function executeClear(): Promise<ClearResponse> {
  const raw = await authFetch<unknown>('/api/console/clear', {
    method: 'POST',
    body: { confirmation: 'CLEAR' as const },
  });
  return ClearResponseSchema.parse(raw);
}
