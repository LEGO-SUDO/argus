// Cross-pane contract round-trip — console DTOs (web pane owns this file).
//
// LLD frontend-web Task 1A/1B: one happy-path round-trip per console schema
// the web console consumes, plus a reject-missing-field case for each, plus an
// export-presence sanity check (Task 1B). The backend-api pane authors these
// schemas in packages/contracts/src/console.ts; this file is the frontend's
// proof that the client-consumable shapes parse as expected.
//
// NOTE (contract reconciliation): `ProviderSelectionSchema` named in the LLD's
// coordinated-exports list is intentionally deferred to the
// chat-context-and-ux-polish bundle and is NOT authored here — the replay
// ProviderModelPicker reads its catalog from `ProviderAvailabilityResponseSchema`
// instead, which IS asserted below. So ProviderSelection is omitted.
import {
  TimeWindowSchema,
  InferenceStatusSchema,
  TraceRowSchema,
  TraceListResponseSchema,
  ThroughputSchema,
  CostGroupSchema,
  CostResponseSchema,
  ReplayCandidateSchema,
  ReplayCandidatesResponseSchema,
  ReplayDetailSchema,
  ReplayRunRequestSchema,
  ReplayRunResponseSchema,
  DiffResultSchema,
  GenerateSamplesRequestSchema,
  SampleGenerateResponseSchema,
  ClearPreviewResponseSchema,
  ClearExecuteRequestSchema,
  ClearResponseSchema,
  BadgeLagResponseSchema,
  LiveBadgeStateSchema,
  ProviderAvailabilityResponseSchema,
  CONSOLE_LIVE_PATH,
} from '@argus/contracts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const ISO = '2026-05-25T12:00:00.000Z';

describe('TimeWindowSchema', () => {
  it('accepts the three windows and rejects others', () => {
    expect(TimeWindowSchema.parse('24h')).toBe('24h');
    expect(TimeWindowSchema.parse('7d')).toBe('7d');
    expect(TimeWindowSchema.parse('all')).toBe('all');
    expect(TimeWindowSchema.safeParse('30d').success).toBe(false);
  });
});

describe('InferenceStatusSchema', () => {
  it('accepts the terminal statuses', () => {
    for (const s of ['ok', 'streaming', 'failed', 'canceled', 'timed_out']) {
      expect(InferenceStatusSchema.parse(s)).toBe(s);
    }
    expect(InferenceStatusSchema.safeParse('succeeded').success).toBe(false);
  });
});

const VALID_TRACE_ROW = {
  id: UUID_A,
  // R3 reconciliation: TraceRow now carries the OTel trace id (Jaeger deep link).
  traceId: 'abcdef0123456789abcdef0123456789',
  conversationId: UUID_B,
  conversationTitle: 'A conversation',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok' as const,
  kind: 'chat' as const,
  startedAt: ISO,
  endedAt: ISO,
  latencyMs: 1234,
  promptTokens: 100,
  completionTokens: 50,
  promptCostMicros: 200,
  completionCostMicros: 300,
  totalCostMicros: 500,
  inputPreview: 'hello',
  outputPreview: 'world',
  errorCode: null,
};

describe('TraceRowSchema + TraceListResponseSchema', () => {
  it('round-trips a fully-populated trace row', () => {
    expect(TraceRowSchema.parse(VALID_TRACE_ROW)).toEqual(VALID_TRACE_ROW);
  });

  it('accepts nullable token / latency / cost columns', () => {
    const sparse = {
      ...VALID_TRACE_ROW,
      conversationTitle: null,
      endedAt: null,
      latencyMs: null,
      promptTokens: null,
      completionTokens: null,
      promptCostMicros: null,
      completionCostMicros: null,
      totalCostMicros: null,
      inputPreview: null,
      outputPreview: null,
    };
    expect(TraceRowSchema.parse(sparse)).toEqual(sparse);
  });

  it('rejects a trace row missing the required provider field', () => {
    const { provider: _omit, ...rest } = VALID_TRACE_ROW;
    expect(TraceRowSchema.safeParse(rest).success).toBe(false);
  });

  it('round-trips the trace list response envelope', () => {
    const response = {
      rows: [VALID_TRACE_ROW],
      throughput: { turnsPerHour: 12, tokensPerHour: 3400, errorRate: 0.25 },
      next_cursor: null,
    };
    expect(TraceListResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a list response missing throughput', () => {
    expect(
      TraceListResponseSchema.safeParse({ rows: [], next_cursor: null }).success,
    ).toBe(false);
  });
});

describe('ThroughputSchema', () => {
  it('rejects an error rate above 1', () => {
    expect(
      ThroughputSchema.safeParse({
        turnsPerHour: 1,
        tokensPerHour: 1,
        errorRate: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe('CostGroupSchema + CostResponseSchema', () => {
  const group = {
    key: UUID_B,
    label: 'gpt-4o',
    promptCostMicros: 1000,
    completionCostMicros: 2000,
    totalCostMicros: 3000,
    unpricedCount: 0,
  };

  it('round-trips a cost group', () => {
    expect(CostGroupSchema.parse(group)).toEqual(group);
  });

  it('rejects a cost group missing totalCostMicros', () => {
    const { totalCostMicros: _omit, ...rest } = group;
    expect(CostGroupSchema.safeParse(rest).success).toBe(false);
  });

  it('round-trips the cost response envelope', () => {
    const response = {
      groups: [group],
      total_micro_usd: 3000,
      sparkline: [{ hourStart: ISO, costMicros: 3000 }],
      unpriced_models: ['some-unpriced-model'],
    };
    expect(CostResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a cost response missing unpriced_models', () => {
    expect(
      CostResponseSchema.safeParse({
        groups: [group],
        total_micro_usd: 3000,
        sparkline: [],
      }).success,
    ).toBe(false);
  });
});

describe('ReplayCandidateSchema + ReplayCandidatesResponseSchema', () => {
  const candidate = {
    id: UUID_A,
    conversationId: UUID_B,
    conversationTitle: 'Convo',
    provider: 'openai',
    model: 'gpt-4o',
    status: 'ok' as const,
    startedAt: ISO,
    inputPreview: 'prompt',
    eligibility: 'eligible' as const,
  };

  it('round-trips a replay candidate', () => {
    expect(ReplayCandidateSchema.parse(candidate)).toEqual(candidate);
  });

  it('rejects a candidate with an unknown eligibility', () => {
    expect(
      ReplayCandidateSchema.safeParse({ ...candidate, eligibility: 'maybe' })
        .success,
    ).toBe(false);
  });

  it('round-trips the candidates response envelope', () => {
    const response = { candidates: [candidate], next_cursor: null };
    expect(ReplayCandidatesResponseSchema.parse(response)).toEqual(response);
  });
});

describe('ReplayDetailSchema', () => {
  it('round-trips a replay detail row', () => {
    const detail = { ...VALID_TRACE_ROW, eligibility: 'eligible_with_warning' as const };
    expect(ReplayDetailSchema.parse(detail)).toEqual(detail);
  });

  it('rejects a detail missing eligibility', () => {
    expect(ReplayDetailSchema.safeParse(VALID_TRACE_ROW).success).toBe(false);
  });
});

describe('ReplayRunRequestSchema + ReplayRunResponseSchema + DiffResultSchema', () => {
  it('round-trips a replay-run request', () => {
    const req = { sourceInferenceId: UUID_A, provider: 'anthropic', model: 'claude-3-7' };
    expect(ReplayRunRequestSchema.parse(req)).toEqual(req);
  });

  it('rejects a request missing the source inference id', () => {
    expect(
      ReplayRunRequestSchema.safeParse({ provider: 'openai', model: 'gpt-4o' })
        .success,
    ).toBe(false);
  });

  it('round-trips a replay-run response with a computed diff', () => {
    const res = {
      messageId: UUID_A,
      inferenceId: UUID_B,
      conversationId: UUID_C,
      diff: {
        changes: [
          { value: 'shared ' },
          { value: 'added', added: true },
          { value: 'removed', removed: true },
        ],
      },
    };
    expect(ReplayRunResponseSchema.parse(res)).toEqual(res);
  });

  it('accepts a null diff (async kickoff) and a tooLarge diff sentinel', () => {
    expect(
      ReplayRunResponseSchema.parse({
        messageId: UUID_A,
        inferenceId: UUID_B,
        conversationId: UUID_C,
        diff: null,
      }).diff,
    ).toBeNull();
    expect(DiffResultSchema.parse({ tooLarge: true })).toEqual({ tooLarge: true });
  });
});

describe('GenerateSamplesRequestSchema + SampleGenerateResponseSchema', () => {
  it('round-trips an optional-count request and a response', () => {
    expect(GenerateSamplesRequestSchema.parse({})).toEqual({});
    expect(GenerateSamplesRequestSchema.parse({ count: 10 })).toEqual({ count: 10 });
    const res = { workspaceId: UUID_A, count: 12 };
    expect(SampleGenerateResponseSchema.parse(res)).toEqual(res);
  });

  it('rejects a response missing workspaceId', () => {
    expect(SampleGenerateResponseSchema.safeParse({ count: 1 }).success).toBe(false);
  });
});

describe('ClearPreviewResponseSchema + ClearExecuteRequestSchema + ClearResponseSchema', () => {
  it('round-trips the per-kind breakdown', () => {
    const breakdown = { total: 9, chat: 5, replay: 2, sample: 2 };
    expect(ClearPreviewResponseSchema.parse(breakdown)).toEqual(breakdown);
    expect(ClearResponseSchema.parse(breakdown)).toEqual(breakdown);
  });

  it('requires the literal CLEAR confirmation token', () => {
    expect(ClearExecuteRequestSchema.parse({ confirmation: 'CLEAR' })).toEqual({
      confirmation: 'CLEAR',
    });
    expect(ClearExecuteRequestSchema.safeParse({ confirmation: 'clear' }).success).toBe(
      false,
    );
    expect(ClearExecuteRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('BadgeLagResponseSchema / LiveBadgeStateSchema', () => {
  it('round-trips each badge state', () => {
    expect(BadgeLagResponseSchema.parse({ state: 'live' })).toEqual({ state: 'live' });
    const behind = { state: 'behind' as const, lagSeconds: 12 };
    expect(BadgeLagResponseSchema.parse(behind)).toEqual(behind);
    const err = { state: 'error' as const, message: 'db unreachable' };
    expect(LiveBadgeStateSchema.parse(err)).toEqual(err);
  });

  it('rejects an unknown state', () => {
    expect(BadgeLagResponseSchema.safeParse({ state: 'stale' }).success).toBe(false);
  });
});

describe('ProviderAvailabilityResponseSchema', () => {
  const response = {
    providers: [
      {
        provider: 'openai',
        available: true,
        models: [
          {
            model: 'gpt-4o',
            promptPerMillionUsd: 2.5,
            completionPerMillionUsd: 10,
            priced: true,
          },
        ],
      },
      { provider: 'mock', available: true, models: [] },
    ],
    snapshotDate: '2026-05-01',
  };

  it('round-trips the per-provider catalog', () => {
    expect(ProviderAvailabilityResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects a response missing snapshotDate', () => {
    expect(
      ProviderAvailabilityResponseSchema.safeParse({ providers: [] }).success,
    ).toBe(false);
  });
});

describe('export presence (LLD Task 1B sanity)', () => {
  it('exposes every console export the web pane consumes', () => {
    for (const schema of [
      TimeWindowSchema,
      InferenceStatusSchema,
      TraceRowSchema,
      TraceListResponseSchema,
      ThroughputSchema,
      CostGroupSchema,
      CostResponseSchema,
      ReplayCandidateSchema,
      ReplayCandidatesResponseSchema,
      ReplayDetailSchema,
      ReplayRunRequestSchema,
      ReplayRunResponseSchema,
      DiffResultSchema,
      GenerateSamplesRequestSchema,
      SampleGenerateResponseSchema,
      ClearPreviewResponseSchema,
      ClearExecuteRequestSchema,
      ClearResponseSchema,
      BadgeLagResponseSchema,
      LiveBadgeStateSchema,
      ProviderAvailabilityResponseSchema,
    ]) {
      expect(schema).toBeDefined();
      expect(typeof schema.parse).toBe('function');
    }
    expect(CONSOLE_LIVE_PATH).toBe('/console/live');
  });
});
