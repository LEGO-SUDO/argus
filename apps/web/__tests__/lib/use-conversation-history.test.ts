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
//
// LLD Tasks 21-32 (this LLD): tokensUsed/tokensBudget hydration on the
// mapped Message; pinFallbackNotice round-trip (fetch → cache → hook →
// clearPinFallbackNotice helper). Both fields are part of the
// MessageListResponse shape the backend ships in the backbone PR; this
// file's tests pin the wire shape via stub payloads.

import { act, renderHook, waitFor } from '@testing-library/react';
import {
  clearPinFallbackNotice,
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

// ---------------------------------------------------------------------------
// LLD Tasks 21-22: tokensUsed / tokensBudget hydration from REST DTO
// ---------------------------------------------------------------------------
describe('useConversationHistory — tokens hydration', () => {
  it('copies tokensUsed and tokensBudget from the messages-list response onto mapped Message', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'hi',
          status: 'complete',
          provider: 'openai',
          model: 'gpt-4o-mini',
          tokensUsed: 4321,
          tokensBudget: 8192,
        },
      ],
      omittedCount: 0,
    });
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status !== 'ready') throw new Error('unreachable');
    const mapped = result.current.messages[0];
    expect(mapped?.tokensUsed).toBe(4321);
    expect(mapped?.tokensBudget).toBe(8192);
  });

  it('leaves token fields undefined when DTO does not carry them', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'hi',
          status: 'complete',
        },
      ],
      omittedCount: 0,
    });
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status !== 'ready') throw new Error('unreachable');
    const mapped = result.current.messages[0];
    expect(mapped?.tokensUsed).toBeUndefined();
    expect(mapped?.tokensBudget).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LLD Tasks 23-32: pinFallbackNotice surface + cache helper.
//
// Wire shape (Locked Contracts mirror): the messages-list response carries
// an OPTIONAL top-level `pinFallbackNotice` object naming the
// previously-pinned provider+model. The hook surfaces it on its `ready`
// snapshot for the MessageComposer to render an inline notice on first
// paint. `clearPinFallbackNotice(conversationId)` is the public helper for
// dismissal; it preserves messages and omittedCount.
// ---------------------------------------------------------------------------
describe('useConversationHistory — pinFallbackNotice surface', () => {
  // Task 23-24
  it('surfaces pinFallbackNotice from the response on the ready snapshot', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [],
      omittedCount: 0,
      pinFallbackNotice: {
        previousProvider: 'openai',
        previousModel: 'gpt-4o-mini',
      },
    });
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.pinFallbackNotice).toEqual({
      previousProvider: 'openai',
      previousModel: 'gpt-4o-mini',
    });
  });

  // Task 25-26
  it('preserves the notice across hook unmount → remount via the module cache', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [],
      omittedCount: 0,
      pinFallbackNotice: {
        previousProvider: 'anthropic',
        previousModel: 'claude-3-sonnet',
      },
    });
    const first = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(first.result.current.status).toBe('ready');
    });
    first.unmount();

    // Remount — should rehydrate from cache without re-fetching.
    const second = renderHook(() => useConversationHistory(CONV_ID));
    expect(second.result.current.status).toBe('ready');
    if (second.result.current.status !== 'ready') throw new Error('unreachable');
    expect(second.result.current.pinFallbackNotice).toEqual({
      previousProvider: 'anthropic',
      previousModel: 'claude-3-sonnet',
    });
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });

  // Task 27-28
  it('clearPinFallbackNotice removes the notice for the targeted conversation only', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [],
      omittedCount: 0,
      pinFallbackNotice: { previousProvider: 'p1', previousModel: 'm1' },
    });
    authFetchMock.mockResolvedValueOnce({
      messages: [],
      omittedCount: 0,
      pinFallbackNotice: { previousProvider: 'p2', previousModel: 'm2' },
    });
    // Prime both conversations.
    const h1 = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(h1.result.current.status).toBe('ready');
    });
    const h2 = renderHook(() => useConversationHistory(OTHER_CONV_ID));
    await waitFor(() => {
      expect(h2.result.current.status).toBe('ready');
    });
    h1.unmount();
    h2.unmount();

    // Clear only CONV_ID.
    act(() => {
      clearPinFallbackNotice(CONV_ID);
    });

    // Remount both; the cleared conversation has no notice; the other still does.
    const after1 = renderHook(() => useConversationHistory(CONV_ID));
    if (after1.result.current.status !== 'ready') throw new Error('unreachable');
    expect(after1.result.current.pinFallbackNotice).toBeUndefined();

    const after2 = renderHook(() => useConversationHistory(OTHER_CONV_ID));
    if (after2.result.current.status !== 'ready') throw new Error('unreachable');
    expect(after2.result.current.pinFallbackNotice).toEqual({
      previousProvider: 'p2',
      previousModel: 'm2',
    });
  });

  // Task 29-30
  it('clearPinFallbackNotice preserves messages and omittedCount', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [
        { id: 'm1', role: 'user', content: 'hi', status: 'complete' },
      ],
      omittedCount: 7,
      pinFallbackNotice: { previousProvider: 'p1', previousModel: 'm1' },
    });
    const h1 = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(h1.result.current.status).toBe('ready');
    });
    h1.unmount();

    act(() => {
      clearPinFallbackNotice(CONV_ID);
    });

    const after = renderHook(() => useConversationHistory(CONV_ID));
    if (after.result.current.status !== 'ready') throw new Error('unreachable');
    expect(after.result.current.messages).toHaveLength(1);
    expect(after.result.current.messages[0]?.id).toBe('m1');
    expect(after.result.current.omittedCount).toBe(7);
    expect(after.result.current.pinFallbackNotice).toBeUndefined();
  });

  // Task 31-32
  it('absence of pinFallbackNotice in response leaves ready.pinFallbackNotice undefined', async () => {
    authFetchMock.mockResolvedValueOnce({
      messages: [],
      omittedCount: 0,
      // no pinFallbackNotice
    });
    const { result } = renderHook(() => useConversationHistory(CONV_ID));
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    if (result.current.status !== 'ready') throw new Error('unreachable');
    expect(result.current.pinFallbackNotice).toBeUndefined();
  });
});
