// Tests for the console REST client (LLD frontend-web Phase 3, Tasks 32-53).
//
// We mock the underlying fetch layers (`authFetch` for browser helpers,
// `serverApiFetch` for server helpers) so we can assert the outbound path /
// query / body precisely, while keeping the REAL AuthError / ApiError classes
// so the error-propagation tests (Task 52) exercise the genuine types. The
// helper's own `Schema.parse(...)` still runs against the mock's return value,
// proving each helper validates the response.

jest.mock('@/lib/auth-fetch', () => {
  const actual = jest.requireActual('@/lib/auth-fetch');
  return { ...actual, authFetch: jest.fn() };
});
jest.mock('@/lib/server-api-fetch', () => {
  const actual = jest.requireActual('@/lib/server-api-fetch');
  return { ...actual, serverApiFetch: jest.fn() };
});

import { authFetch, AuthError, ApiError } from '@/lib/auth-fetch';
import { serverApiFetch } from '@/lib/server-api-fetch';
import * as api from '@/lib/console-api';
import {
  fetchTracesServer,
  fetchProviderAvailabilityServer,
} from '@/lib/console-api.server';
import { emptyTracesFilter } from '@/lib/traces-filter-encoding';

const mockAuthFetch = authFetch as jest.Mock;
const mockServerFetch = serverApiFetch as jest.Mock;

const UUID = '11111111-1111-4111-8111-111111111111';
const ISO = '2026-05-25T12:00:00.000Z';

const TRACE_ROW = {
  id: UUID,
  traceId: 'abcdef0123456789abcdef0123456789',
  conversationId: '22222222-2222-4222-8222-222222222222',
  conversationTitle: 'c',
  provider: 'openai',
  model: 'gpt-4o',
  status: 'ok',
  kind: 'chat',
  startedAt: ISO,
  endedAt: ISO,
  latencyMs: 10,
  promptTokens: 1,
  completionTokens: 2,
  promptCostMicros: 3,
  completionCostMicros: 4,
  totalCostMicros: 7,
  inputPreview: 'in',
  outputPreview: 'out',
  errorCode: null,
};
const TRACE_LIST = {
  rows: [TRACE_ROW],
  throughput: { turnsPerHour: 1, tokensPerHour: 2, errorRate: 0 },
  next_cursor: null,
};
const COST_RESPONSE = {
  groups: [],
  total_micro_usd: 0,
  sparkline: [],
  unpriced_models: [],
};
const AVAILABILITY = {
  providers: [{ provider: 'mock', available: true, models: [] }],
  snapshotDate: '2026-05-01',
};

beforeEach(() => {
  mockAuthFetch.mockReset();
  mockServerFetch.mockReset();
});

function lastAuthPath(): string {
  return mockAuthFetch.mock.calls.at(-1)![0] as string;
}
function lastAuthOpts(): { method?: string; body?: unknown } {
  return (mockAuthFetch.mock.calls.at(-1)![1] ?? {}) as { method?: string; body?: unknown };
}

describe('fetchTraces (Tasks 32, 34)', () => {
  it('GETs /api/console/traces with window + filters and parses the response', async () => {
    mockAuthFetch.mockResolvedValue(TRACE_LIST);
    const result = await api.fetchTraces({
      window: '7d',
      filter: { ...emptyTracesFilter(), provider: ['openai'], search: 'hi' },
    });
    const path = lastAuthPath();
    expect(path.startsWith('/api/console/traces?')).toBe(true);
    expect(path).toContain('provider=openai');
    expect(path).toContain('search=hi');
    expect(path).toContain('window=7d');
    expect(result).toEqual(TRACE_LIST);
  });

  it('encodes repeated multi-value filter keys (Task 34)', async () => {
    mockAuthFetch.mockResolvedValue(TRACE_LIST);
    await api.fetchTraces({
      window: '24h',
      filter: { ...emptyTracesFilter(), status: ['ok', 'failed'] },
    });
    const query = lastAuthPath().split('?')[1]!;
    expect(new URLSearchParams(query).getAll('status')).toEqual(['ok', 'failed']);
  });
});

describe('fetchCost (Task 36)', () => {
  it('GETs /api/console/cost with window/groupBy/includeSample/includeReplay', async () => {
    mockAuthFetch.mockResolvedValue(COST_RESPONSE);
    const result = await api.fetchCost({
      window: 'all',
      groupBy: 'provider',
      includeSample: true,
      includeReplay: false,
    });
    const path = lastAuthPath();
    expect(path.startsWith('/api/console/cost?')).toBe(true);
    const q = new URLSearchParams(path.split('?')[1]!);
    expect(q.get('window')).toBe('all');
    expect(q.get('groupBy')).toBe('provider');
    expect(q.get('includeSample')).toBe('true');
    expect(q.get('includeReplay')).toBe('false');
    expect(result).toEqual(COST_RESPONSE);
  });
});

describe('replay fetchers (Task 38)', () => {
  it('fetchReplayCandidates GETs /api/console/replay/candidates with a window param', async () => {
    const candidates = { candidates: [], next_cursor: null };
    mockAuthFetch.mockResolvedValue(candidates);
    const result = await api.fetchReplayCandidates({ window: '7d' });
    const path = lastAuthPath();
    expect(path.startsWith('/api/console/replay/candidates?')).toBe(true);
    expect(path).toContain('window=7d');
    expect(result).toEqual(candidates);
  });

  it('fetchReplayDetail GETs /api/console/replay/:id', async () => {
    const detail = { ...TRACE_ROW, eligibility: 'eligible', diff: null };
    mockAuthFetch.mockResolvedValue(detail);
    const result = await api.fetchReplayDetail(UUID);
    expect(lastAuthPath()).toBe(`/api/console/replay/${UUID}`);
    expect(result).toEqual(detail);
  });
});

describe('runReplay (Task 40)', () => {
  it('POSTs /api/console/replay/run with a ReplayRunRequest body and parses the response', async () => {
    const response = {
      messageId: UUID,
      inferenceId: '22222222-2222-4222-8222-222222222222',
      conversationId: '33333333-3333-4333-8333-333333333333',
      diff: null,
    };
    mockAuthFetch.mockResolvedValue(response);
    const req = { sourceInferenceId: UUID, provider: 'anthropic', model: 'claude-3-7' };
    const result = await api.runReplay(req);
    expect(lastAuthPath()).toBe('/api/console/replay/run');
    expect(lastAuthOpts().method).toBe('POST');
    expect(lastAuthOpts().body).toEqual(req);
    expect(result).toEqual(response);
  });
});

describe('generateSample (Task 42)', () => {
  it('POSTs /api/console/samples/generate and parses the response', async () => {
    mockAuthFetch.mockResolvedValue({ workspaceId: UUID, count: 8 });
    const result = await api.generateSample({ count: 8 });
    expect(lastAuthPath()).toBe('/api/console/samples/generate');
    expect(lastAuthOpts().method).toBe('POST');
    expect(result).toEqual({ workspaceId: UUID, count: 8 });
  });
});

describe('previewClear + executeClear (Tasks 44, 46)', () => {
  it('previewClear GETs /api/console/clear/preview', async () => {
    const breakdown = { total: 3, chat: 1, replay: 1, sample: 1 };
    mockAuthFetch.mockResolvedValue(breakdown);
    const result = await api.previewClear();
    expect(lastAuthPath()).toBe('/api/console/clear/preview');
    expect(result).toEqual(breakdown);
  });

  it('executeClear POSTs /api/console/clear with the literal CLEAR confirmation', async () => {
    const breakdown = { total: 3, chat: 1, replay: 1, sample: 1 };
    mockAuthFetch.mockResolvedValue(breakdown);
    const result = await api.executeClear();
    expect(lastAuthPath()).toBe('/api/console/clear');
    expect(lastAuthOpts().method).toBe('POST');
    expect(lastAuthOpts().body).toEqual({ confirmation: 'CLEAR' });
    expect(result).toEqual(breakdown);
  });
});

describe('fetchProviderAvailability — both variants (Task 48)', () => {
  it('browser variant GETs /api/providers/availability via authFetch', async () => {
    mockAuthFetch.mockResolvedValue(AVAILABILITY);
    const result = await api.fetchProviderAvailability();
    expect(lastAuthPath()).toBe('/api/providers/availability');
    expect(result).toEqual(AVAILABILITY);
  });

  it('server variant GETs bare /providers/availability via serverApiFetch', async () => {
    mockServerFetch.mockResolvedValue(AVAILABILITY);
    const result = await fetchProviderAvailabilityServer('cookie=abc');
    expect(mockServerFetch.mock.calls.at(-1)![0]).toBe('/providers/availability');
    expect(mockServerFetch.mock.calls.at(-1)![1]).toMatchObject({ cookieHeader: 'cookie=abc' });
    expect(result).toEqual(AVAILABILITY);
  });
});

describe('fetchBadgeLag (Task 50)', () => {
  it('GETs /api/console/live/badge and parses the BadgeLagResponse', async () => {
    mockAuthFetch.mockResolvedValue({ state: 'behind', lagSeconds: 7 });
    const result = await api.fetchBadgeLag();
    expect(lastAuthPath()).toBe('/api/console/live/badge');
    expect(result).toEqual({ state: 'behind', lagSeconds: 7 });
  });
});

describe('server read helpers use bare /console paths', () => {
  it('fetchTracesServer hits bare /console/traces with the cookie header', async () => {
    mockServerFetch.mockResolvedValue(TRACE_LIST);
    const result = await fetchTracesServer({ window: '24h', filter: emptyTracesFilter() }, 'cookie=x');
    const path = mockServerFetch.mock.calls.at(-1)![0] as string;
    expect(path.startsWith('/console/traces')).toBe(true);
    expect(mockServerFetch.mock.calls.at(-1)![1]).toMatchObject({ cookieHeader: 'cookie=x' });
    expect(result).toEqual(TRACE_LIST);
  });
});

describe('error propagation (Task 52)', () => {
  it('rethrows AuthError unchanged', async () => {
    mockAuthFetch.mockRejectedValue(new AuthError('unauthenticated', 401));
    await expect(api.fetchBadgeLag()).rejects.toBeInstanceOf(AuthError);
  });

  it('rethrows ApiError unchanged', async () => {
    mockAuthFetch.mockRejectedValue(new ApiError('boom', 500, 'INTERNAL'));
    await expect(api.previewClear()).rejects.toBeInstanceOf(ApiError);
  });
});
