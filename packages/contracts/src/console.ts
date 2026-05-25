// Console REST DTOs — the `/console/*` control-plane surface shared by the API
// (which serves these shapes) and the web console (which renders them).
//
// Field-naming rule (CONTRACTS.md §Naming): the explicitly-pinned top-level
// response fields are snake_case (`rows`, `throughput`, `next_cursor`,
// `total_micro_usd`, `sparkline`, `unpriced_models`); `LiveBadgeStateSchema`
// uses camelCase `lagSeconds` as pinned. Every other (unpinned) field uses
// camelCase to match the Phase A conversation DTOs — because both API and web
// import THESE schemas, the naming is automatically consistent.
import { z } from 'zod';
import { LiveEventKindEnum } from './live-events';

// SSE path constant — the web client and any curl smoke test dial this exact
// bare path; the dedicated LiveController owns it (never ConsoleController).
export const CONSOLE_LIVE_PATH = '/console/live';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// Time windows for every read surface. `all` returns rows of any age.
export const TimeWindowSchema = z.enum(['24h', '7d', 'all']);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

// Phase B extends the Phase A LlmStatus set with `timed_out` (terminal). Kept
// local to the console contract so the Phase A `LlmStatusSchema` (used by the
// projection wire contract) stays untouched.
export const InferenceStatusSchema = z.enum([
  'ok',
  'streaming',
  'failed',
  'canceled',
  'timed_out',
]);
export type InferenceStatus = z.infer<typeof InferenceStatusSchema>;

// Boolean query-string flag: accepts a real boolean (programmatic) or the
// string forms a browser sends, defaulting to false when absent.
const booleanFlag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

// ---------------------------------------------------------------------------
// Traces tab
// ---------------------------------------------------------------------------

export const TraceRowSchema = z.object({
  id: z.string().uuid(),
  // OTel trace id (shared by the inference's spans) — powers the web Jaeger
  // deep link `${JAEGER_BASE_URL}/trace/${traceId}`. Empty string when the
  // inference has no trace event yet.
  traceId: z.string(),
  conversationId: z.string().uuid(),
  conversationTitle: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  status: InferenceStatusSchema,
  kind: LiveEventKindEnum,
  startedAt: z.string(), // ISO-8601
  endedAt: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  promptCostMicros: z.number().int().nonnegative().nullable(),
  completionCostMicros: z.number().int().nonnegative().nullable(),
  totalCostMicros: z.number().int().nonnegative().nullable(),
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type TraceRow = z.infer<typeof TraceRowSchema>;

// Multi-select query filter: accepts a single value OR repeated query keys
// (express yields a string for one key, a string[] for repeats) and normalizes
// to an optional array. Absent → undefined (no filter on that dimension).
const multiFilter = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
    z.array(inner).optional(),
  );

export const TracesQuerySchema = z.object({
  // Combinable (ANDed across dimensions) multi-select filters; each accepts
  // repeated query keys → an IN (...) predicate.
  provider: multiFilter(z.string()),
  model: multiFilter(z.string()),
  status: multiFilter(InferenceStatusSchema),
  conversationId: multiFilter(z.string().uuid()),
  search: z.string().optional(),
  window: TimeWindowSchema.default('24h'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type TracesQuery = z.infer<typeof TracesQuerySchema>;

// Throughput header on the Traces feed — chat-only counts (HLD aggregates).
export const ThroughputSchema = z.object({
  turnsPerHour: z.number().nonnegative(),
  tokensPerHour: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
});
export type Throughput = z.infer<typeof ThroughputSchema>;

export const TraceListResponseSchema = z.object({
  rows: z.array(TraceRowSchema),
  throughput: ThroughputSchema,
  next_cursor: z.string().nullable(),
});
export type TraceListResponse = z.infer<typeof TraceListResponseSchema>;
// Alias for the backend-api LLD spelling.
export const TracesResponseSchema = TraceListResponseSchema;
export type TracesResponse = TraceListResponse;

// ---------------------------------------------------------------------------
// Cost tab
// ---------------------------------------------------------------------------

export const CostGroupBySchema = z.enum(['conversation', 'provider', 'model']);
export type CostGroupBy = z.infer<typeof CostGroupBySchema>;

export const CostQuerySchema = z.object({
  groupBy: CostGroupBySchema.default('conversation'),
  window: TimeWindowSchema.default('24h'),
  includeReplay: booleanFlag,
  includeMock: booleanFlag,
  includeSample: booleanFlag,
});
export type CostQuery = z.infer<typeof CostQuerySchema>;

export const CostGroupSchema = z.object({
  // conversationId / provider id / model id depending on groupBy.
  key: z.string(),
  // Human label (conversation title / provider name / model name).
  label: z.string(),
  promptCostMicros: z.number().int().nonnegative(),
  completionCostMicros: z.number().int().nonnegative(),
  totalCostMicros: z.number().int().nonnegative(),
  // Count of rows in this group with no pricing (both cost columns null).
  unpricedCount: z.number().int().nonnegative(),
});
export type CostGroup = z.infer<typeof CostGroupSchema>;

export const SparklinePointSchema = z.object({
  hourStart: z.string(), // ISO-8601, start of the hour bucket
  costMicros: z.number().int().nonnegative(),
});
export type SparklinePoint = z.infer<typeof SparklinePointSchema>;

export const CostResponseSchema = z.object({
  groups: z.array(CostGroupSchema),
  total_micro_usd: z.number().int().nonnegative(),
  sparkline: z.array(SparklinePointSchema),
  // Deduped list of models that contributed rows with no pricing.
  unpriced_models: z.array(z.string()),
});
export type CostResponse = z.infer<typeof CostResponseSchema>;

// ---------------------------------------------------------------------------
// Replay tab
// ---------------------------------------------------------------------------

export const ReplayEligibilitySchema = z.enum([
  'eligible',
  'eligible_with_warning',
  'ineligible',
]);
export type ReplayEligibility = z.infer<typeof ReplayEligibilitySchema>;

export const ReplayCandidatesQuerySchema = z.object({
  window: TimeWindowSchema.default('24h'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type ReplayCandidatesQuery = z.infer<typeof ReplayCandidatesQuerySchema>;

export const ReplayCandidateSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  conversationTitle: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  status: InferenceStatusSchema,
  startedAt: z.string(),
  inputPreview: z.string().nullable(),
  eligibility: ReplayEligibilitySchema,
});
export type ReplayCandidate = z.infer<typeof ReplayCandidateSchema>;

export const ReplayCandidatesResponseSchema = z.object({
  candidates: z.array(ReplayCandidateSchema),
  next_cursor: z.string().nullable(),
});
export type ReplayCandidatesResponse = z.infer<typeof ReplayCandidatesResponseSchema>;

// Word-level diff payload (jsdiff change list) or a sentinel when either side
// exceeds the replay output-size cap.
export const DiffChangeSchema = z.object({
  value: z.string(),
  added: z.boolean().optional(),
  removed: z.boolean().optional(),
});
export type DiffChange = z.infer<typeof DiffChangeSchema>;

export const DiffResultSchema = z.union([
  z.object({ changes: z.array(DiffChangeSchema) }),
  z.object({ tooLarge: z.literal(true) }),
]);
export type DiffResult = z.infer<typeof DiffResultSchema>;

export const ReplayDetailSchema = z.object({
  id: z.string().uuid(),
  // OTel trace id (Jaeger deep link), mirroring TraceRow. Empty string when
  // the inference has no trace event yet.
  traceId: z.string(),
  conversationId: z.string().uuid(),
  conversationTitle: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  status: InferenceStatusSchema,
  kind: LiveEventKindEnum,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  promptCostMicros: z.number().int().nonnegative().nullable(),
  completionCostMicros: z.number().int().nonnegative().nullable(),
  totalCostMicros: z.number().int().nonnegative().nullable(),
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  errorCode: z.string().nullable(),
  eligibility: ReplayEligibilitySchema,
  // Word-level diff of this row's output vs its replay SOURCE's output.
  // Non-null only for a terminal `kind='replay'` row whose source has output
  // (the replay comparison the UI renders); null for sources, in-flight
  // replays, or when either output is missing.
  diff: DiffResultSchema.nullable(),
});
export type ReplayDetail = z.infer<typeof ReplayDetailSchema>;

export const ReplayRunRequestSchema = z.object({
  sourceInferenceId: z.string().uuid(),
  provider: z.string(),
  model: z.string(),
});
export type ReplayRunRequest = z.infer<typeof ReplayRunRequestSchema>;

export const ReplayRunResponseSchema = z.object({
  // New replay assistant message id (the gateway-minted message).
  messageId: z.string().uuid(),
  // New `kind='replay'` inference row id.
  inferenceId: z.string().uuid(),
  conversationId: z.string().uuid(),
  // Precomputed diff payload; null at kickoff (the replay turn streams
  // asynchronously) and filled in once the run terminates.
  diff: DiffResultSchema.nullable(),
});
export type ReplayRunResponse = z.infer<typeof ReplayRunResponseSchema>;

// ---------------------------------------------------------------------------
// Generate Samples
// ---------------------------------------------------------------------------

export const GenerateSamplesRequestSchema = z.object({
  count: z.number().int().positive().max(50).optional(),
});
export type GenerateSamplesRequest = z.infer<typeof GenerateSamplesRequestSchema>;

export const SampleGenerateResponseSchema = z.object({
  workspaceId: z.string().uuid(),
  count: z.number().int().nonnegative(),
});
export type SampleGenerateResponse = z.infer<typeof SampleGenerateResponseSchema>;
// Aliases for the backend-api LLD spelling.
export const GenerateSamplesResponseSchema = SampleGenerateResponseSchema;
export type GenerateSamplesResponse = SampleGenerateResponse;

// ---------------------------------------------------------------------------
// Clear (two endpoints: GET preview + POST execute)
// ---------------------------------------------------------------------------

// Count breakdown returned by both the preview (would-delete) and the execute
// (did-delete) endpoints.
export const ClearBreakdownSchema = z.object({
  total: z.number().int().nonnegative(),
  chat: z.number().int().nonnegative(),
  replay: z.number().int().nonnegative(),
  sample: z.number().int().nonnegative(),
});
export type ClearBreakdown = z.infer<typeof ClearBreakdownSchema>;

export const ClearPreviewResponseSchema = ClearBreakdownSchema;
export type ClearPreviewResponse = ClearBreakdown;

export const ClearExecuteRequestSchema = z.object({
  confirmation: z.literal('CLEAR'),
});
export type ClearExecuteRequest = z.infer<typeof ClearExecuteRequestSchema>;
// Alias for the backend-api LLD spelling.
export const ClearRequestSchema = ClearExecuteRequestSchema;
export type ClearRequest = ClearExecuteRequest;

export const ClearResponseSchema = ClearBreakdownSchema;
export type ClearResponse = ClearBreakdown;

// ---------------------------------------------------------------------------
// Live badge (REST poll — GET /console/live/badge)
// ---------------------------------------------------------------------------

export const LiveBadgeStateSchema = z.object({
  state: z.enum(['live', 'behind', 'error']),
  lagSeconds: z.number().nonnegative().optional(),
  message: z.string().optional(),
});
export type LiveBadgeState = z.infer<typeof LiveBadgeStateSchema>;

// Body for GET /console/live/badge — the badge is a 1s REST poll, not SSE.
export const BadgeLagResponseSchema = LiveBadgeStateSchema;
export type BadgeLagResponse = LiveBadgeState;

// ---------------------------------------------------------------------------
// Provider availability (GET /providers/availability)
// ---------------------------------------------------------------------------

// One model in a provider's catalog, sourced from the @argus/sdk pricing
// snapshot (single source of truth — the frontend never hardcodes a catalog).
export const ProviderModelSchema = z.object({
  model: z.string(),
  promptPerMillionUsd: z.number().nonnegative(),
  completionPerMillionUsd: z.number().nonnegative(),
  // false when the snapshot has no real pricing (both columns 0).
  priced: z.boolean(),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderCatalogSchema = z.object({
  provider: z.string(), // openai | anthropic | gemini | mock
  // Whether the provider is usable in this deployment (API key configured;
  // mock is always available).
  available: z.boolean(),
  models: z.array(ProviderModelSchema),
});
export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>;

export const ProviderAvailabilityResponseSchema = z.object({
  providers: z.array(ProviderCatalogSchema),
  // Pricing snapshot date carried from the SDK pricebook.
  snapshotDate: z.string(),
});
export type ProviderAvailabilityResponse = z.infer<
  typeof ProviderAvailabilityResponseSchema
>;
