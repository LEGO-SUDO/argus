// useConversationHistory — unit tests for the client-side history fetch
// hook that hydrates MessageStream on direct URL hits (refresh /
// paste-link).
//
// We render the hook in a host component via RTL so React's effect order
// matches production. The browser-side fetch (`authFetch`) is mocked so
// we control fetch behavior deterministically.
//
// The hook intentionally calls `authFetch` directly rather than the
// shared `getMessages` helper in conversations-api.ts — that module pulls
// in `server-only` via `serverApiFetch`, which Next.js rejects when the
// import graph reaches a client component. The test therefore mocks
// authFetch and shapes returns to match the MessageListResponse contract.

import { renderHook, waitFor } from '@testing-library/react';
import {
  primeConversationHistoryCache,
  useConversationHistory,
  _resetConversationHistoryCacheForTests,
} from '@/lib/use-conversation-history';

const CONV_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CONV_ID = '33333333-3333-4333-8333-333333333333';

const authFetchMock = jest.fn();
jest.mock('@/lib/auth-fetch', () => {
  const actual = jest.requireActual('@/lib/auth-fetch') as object;
  return {
    __esModule: true,
    ...actual,
    authFetch: (...args: unknown[]) => authFetchMock(...args),
  };
});

// Helper: stub the next history response. `authFetch` returns the raw
// MessageListResponse shape (messages + omittedCount at the top level).
function stubHistory(
  messages: Array<Partial<{ id: string; role: string; content: string; status: string }>>,
  omittedCount = 0,
) {
  authFetchMock.mockResolvedValueOnce({ messages, omittedCount });
}

beforeEach(() => {
  authFetchMock.mockReset();
  _resetConversationHistoryCacheForTests();
});

describe('useConversationHistory — null id', () => {
  it('returns idle state when conversationId is null', () => {
    const { result } = renderHook(() => useConversationHistory(null));
    expect(result.current).toEqual({ status: 'idle' });
    expect(authFetchMock).not.toHaveBeenCalled();
  });
});

describe('useConversationHistory — fetch path', () => {
  it('starts in loading state and resolves to ready', async () => {
    stubHistory(
      [{ id: 'm1', role: 'user', content: 'hi', status: 'complete' }],
      2,
    );
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.conversationId).toBe(CONV_ID);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.omittedCount).toBe(2);
  });

  it('emits error state when the api rejects', async () => {
    authFetchMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    if (result.current.status !== 'error') throw new Error('unreachable');
    expect(result.current.error.message).toContain('boom');
  });

  it('caches the result — second mount for the same id is synchronous and skips fetch', async () => {
    stubHistory(
      [{ id: 'm1', role: 'assistant', content: 'cached', status: 'complete' }],
      0,
    );
    const first = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(first.result.current.status).toBe('ready');
    });
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    // Fresh hook for the SAME id — should hit the cache and skip the fetch.
    const second = renderHook(() => useConversationHistory(CONV_ID));
    expect(second.result.current.status).toBe('ready');
    if (second.result.current.status !== 'ready') throw new Error('unreachable');
    expect(second.result.current.messages[0]!.content).toBe('cached');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useConversationHistory — skipFor (just-minted ids)', () => {
  it('returns ready with empty messages without fetching when id is in skipFor', () => {
    const skip = new Set([CONV_ID]);
    const { result } = renderHook(() =>
      useConversationHistory(CONV_ID, { skipFor: skip }),
    );
    expect(result.current.status).toBe('ready');
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.messages).toEqual([]);
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  it('fetches for ids NOT in skipFor even when skipFor has other entries', async () => {
    stubHistory([], 0);
    const skip = new Set([OTHER_CONV_ID]);
    const { result } = renderHook(() =>
      useConversationHistory(CONV_ID, { skipFor: skip }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useConversationHistory — id change', () => {
  it('reruns the fetch when conversationId changes', async () => {
    stubHistory([{ id: 'a', role: 'user', content: 'one', status: 'complete' }], 0);
    stubHistory([{ id: 'b', role: 'user', content: 'two', status: 'complete' }], 0);
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useConversationHistory(id),
      { initialProps: { id: CONV_ID } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    rerender({ id: OTHER_CONV_ID });
    await waitFor(() => {
      if (result.current.status !== 'ready') return;
      expect(result.current.conversationId).toBe(OTHER_CONV_ID);
    });
    expect(authFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('primeConversationHistoryCache', () => {
  it('lets a later mount skip the fetch by hitting the primed entry', () => {
    primeConversationHistoryCache(CONV_ID, {
      messages: [],
      omittedCount: 0,
    });
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    expect(result.current.status).toBe('ready');
    expect(authFetchMock).not.toHaveBeenCalled();
  });
});
