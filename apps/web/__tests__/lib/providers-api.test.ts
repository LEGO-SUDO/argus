// providers-api — unit tests for the catalog fetch + pin set/clear REST
// helpers (LLD Block D, Tasks 57-66).
//
// `authFetch` is mocked so we assert exactly which path/method/body each
// helper invokes. The helpers do NOT pre-stringify the body — serialization
// is owned by `authFetch` (it sets Content-Type and JSON.stringify's the
// `body` option). The helpers also do NOT catch ApiError — it propagates
// unchanged so callers can branch on status/code.

import {
  fetchProviderCatalog,
  patchConversationPin,
  clearConversationPin,
  type ProviderCatalog,
} from '@/lib/providers-api';
import { ApiError } from '@/lib/auth-fetch';

const CONV_ID = '22222222-2222-4222-8222-222222222222';

const authFetchMock = jest.fn();
jest.mock('@/lib/auth-fetch', () => {
  const actual = jest.requireActual('@/lib/auth-fetch') as object;
  return {
    __esModule: true,
    ...actual,
    authFetch: (...args: unknown[]) => authFetchMock(...args),
  };
});

beforeEach(() => {
  authFetchMock.mockReset();
});

describe('fetchProviderCatalog', () => {
  // Task 57-58
  it('calls GET /api/providers and returns the parsed payload unchanged', async () => {
    const payload: ProviderCatalog = {
      providers: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          promptPerMillion: 0.15,
          completionPerMillion: 0.6,
          contextWindow: 128000,
        },
      ],
    };
    authFetchMock.mockResolvedValueOnce(payload);
    const result = await fetchProviderCatalog();
    expect(authFetchMock).toHaveBeenCalledWith('/api/providers', {
      method: 'GET',
    });
    expect(result).toBe(payload);
  });
});

describe('patchConversationPin', () => {
  // Task 59-60
  it('issues PATCH /api/conversations/:id with the pinned provider+model body', async () => {
    authFetchMock.mockResolvedValueOnce(undefined);
    await patchConversationPin(CONV_ID, {
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
    });
    expect(authFetchMock).toHaveBeenCalledWith(`/api/conversations/${CONV_ID}`, {
      method: 'PATCH',
      body: { pinnedProvider: 'openai', pinnedModel: 'gpt-4o-mini' },
    });
  });

  // Task 61-62
  it('rethrows ApiError on 4xx (does not swallow or rewrap)', async () => {
    const err = new ApiError('invalid pin', 400, 'invalid_pin');
    authFetchMock.mockRejectedValueOnce(err);
    await expect(
      patchConversationPin(CONV_ID, {
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      }),
    ).rejects.toBe(err);
  });
});

describe('clearConversationPin', () => {
  // Task 63-64
  it('issues PATCH /api/conversations/:id with both pin fields null', async () => {
    authFetchMock.mockResolvedValueOnce(undefined);
    await clearConversationPin(CONV_ID);
    expect(authFetchMock).toHaveBeenCalledWith(`/api/conversations/${CONV_ID}`, {
      method: 'PATCH',
      body: { pinnedProvider: null, pinnedModel: null },
    });
  });

  // Task 65-66
  it('rethrows ApiError on 4xx', async () => {
    const err = new ApiError('bad', 400, 'invalid_pin');
    authFetchMock.mockRejectedValueOnce(err);
    await expect(clearConversationPin(CONV_ID)).rejects.toBe(err);
  });
});
