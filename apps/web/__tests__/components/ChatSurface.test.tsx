// ChatSurface — tests covering:
//   1. The layout hosts MessageStream and derives conversationId from
//      `usePathname()` (regression guard for the duplicate-WS bug).
//   2. Changing the pathname from `/chat` to `/chat/<id>` does NOT remount
//      MessageStream — the WS connection survives the URL swap.
//   3. Direct URL hit (`/chat/<id>` on first mount) triggers a client-side
//      history fetch and renders a loading state until it lands.
//   4. The `onConversationMinted` callback path marks the id as
//      locally-owned, so the URL-change effect skips the redundant fetch.
//
// We mock `usePathname` with a controllable getter so individual tests
// can simulate route changes. The MessageStream itself is partially
// mocked — we use a real MessageStream with a stub WsClient injected via
// the (testing-only) module monkeypatch route is messy; simpler is to
// mock the MessageStream module entirely and assert on the props the
// surface hands it.

import { act, render, screen } from '@testing-library/react';
import { ChatSurface } from '@/components/chat/ChatSurface';
import { _resetConversationHistoryCacheForTests } from '@/lib/use-conversation-history';

const CONV_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CONV_ID = '99999999-9999-4999-8999-999999999999';

// Controllable pathname mock.
let currentPathname: string = '/chat';
const setPathname = (p: string) => {
  currentPathname = p;
};
jest.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

// Mock the browser fetch primitive that `useConversationHistory` uses
// under the hood. The hook calls `authFetch('/api/conversations/<id>/messages')`
// directly (it can't import the shared `getMessages` helper because
// that module pulls in `server-only`, which Next.js rejects in a client
// import graph). Tests stub a MessageListResponse shape here.
const authFetchMock = jest.fn();
jest.mock('@/lib/auth-fetch', () => {
  const actual = jest.requireActual('@/lib/auth-fetch') as object;
  return {
    __esModule: true,
    ...actual,
    authFetch: (...args: unknown[]) => authFetchMock(...args),
  };
});

// Helper to stub a history fetch with a MessageListResponse-shaped body.
function stubHistory(
  messages: unknown[] = [],
  omittedCount = 0,
) {
  authFetchMock.mockResolvedValueOnce({ messages, omittedCount });
}

// ChatSurface fetches the provider catalog on mount (LLD Task 120). Mock the
// helper so existing tests don't issue a real request; default to an empty
// catalog (resolved) in beforeEach below.
const fetchProviderCatalogMock = jest.fn();
jest.mock('@/lib/providers-api', () => {
  const actual = jest.requireActual('@/lib/providers-api') as object;
  return {
    __esModule: true,
    ...actual,
    fetchProviderCatalog: (...args: unknown[]) =>
      fetchProviderCatalogMock(...args),
  };
});

// Render counter — assigned a fresh instance id per MessageStream mount so
// we can detect remounts across rerenders. The mock also captures the
// latest `onConversationMinted` callback so individual tests can simulate
// the WS start-frame flow.
let mountCount = 0;
let latestOnMinted: ((id: string) => void) | undefined;
const propsLog: Array<{
  conversationId: string | null;
  initialMessagesLength: number;
  omittedCount: number;
}> = [];
jest.mock('@/components/chat/MessageStream', () => {
  const ReactLocal = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    MessageStream: (props: {
      conversationId: string | null;
      initialMessages: unknown[];
      omittedCount?: number;
      onConversationMinted?: (id: string) => void;
    }) => {
      const idRef = ReactLocal.useRef<number | null>(null);
      if (idRef.current === null) {
        mountCount += 1;
        idRef.current = mountCount;
      }
      latestOnMinted = props.onConversationMinted;
      propsLog.push({
        conversationId: props.conversationId,
        initialMessagesLength: props.initialMessages.length,
        omittedCount: props.omittedCount ?? 0,
      });
      return ReactLocal.createElement(
        'div',
        {
          'data-testid': 'message-stream',
          'data-instance-id': String(idRef.current),
          'data-conv-id': props.conversationId ?? 'null',
          'data-initial-len': String(props.initialMessages.length),
        },
        'mock-message-stream',
      );
    },
  };
});

beforeEach(() => {
  currentPathname = '/chat';
  mountCount = 0;
  latestOnMinted = undefined;
  propsLog.length = 0;
  authFetchMock.mockReset();
  // Default the catalog fetch to a resolved empty catalog so existing tests
  // that don't exercise the picker just work. Cases that care override it.
  fetchProviderCatalogMock.mockReset();
  fetchProviderCatalogMock.mockResolvedValue({ providers: [] });
  _resetConversationHistoryCacheForTests();
});

describe('ChatSurface — pathname-derived conversationId', () => {
  it('derives null on /chat (new-conversation surface)', () => {
    setPathname('/chat');
    render(<ChatSurface />);
    const ms = screen.getByTestId('message-stream');
    expect(ms.getAttribute('data-conv-id')).toBe('null');
  });

  it('derives the UUID on /chat/<uuid>', async () => {
    setPathname(`/chat/${CONV_ID}`);
    stubHistory([], 0);
    render(<ChatSurface />);
    // First render is the loading state until the history fetch settles.
    expect(screen.getByTestId('chat-surface-loading')).toBeInTheDocument();
    // Flush microtasks so the fetch resolves and MessageStream mounts.
    await act(async () => {
      await Promise.resolve();
    });
    const ms = screen.getByTestId('message-stream');
    expect(ms.getAttribute('data-conv-id')).toBe(CONV_ID);
  });
});

describe('ChatSurface — pathname change does not remount MessageStream', () => {
  // This is the core regression test for the "Connection issue (socket)"
  // duplicate-WS bug. When the user sends the first message of a new
  // conversation, the server's start frame mints a conversation id and the
  // client updates the URL. ChatSurface must KEEP the same MessageStream
  // mount across that pathname change so the WS connection survives.
  it('keeps the SAME MessageStream instance across /chat → /chat/<minted-id>', async () => {
    setPathname('/chat');
    const { rerender } = render(<ChatSurface />);
    const before = screen.getByTestId('message-stream');
    const instanceBefore = before.getAttribute('data-instance-id');
    expect(instanceBefore).toBe('1');

    // Simulate the real start-frame flow inside MessageStream:
    //   1. WS start frame arrives with a minted id
    //   2. MessageStream calls onConversationMinted(id) BEFORE the
    //      router.replace lands
    //   3. router.replace causes usePathname() to emit the new path
    //
    // We mirror that order: invoke the captured onMinted callback first,
    // then update the pathname and rerender. The mintedIds set should
    // contain the id when the pathname-driven effect runs, so the
    // mountKey stays stable.
    expect(latestOnMinted).toBeDefined();
    act(() => {
      latestOnMinted?.(CONV_ID);
    });

    setPathname(`/chat/${CONV_ID}`);
    rerender(<ChatSurface />);

    await act(async () => {
      await Promise.resolve();
    });

    const after = screen.getByTestId('message-stream');
    const instanceAfter = after.getAttribute('data-instance-id');
    // The mock MessageStream assigns an instance id on first render via
    // a ref. If the host remounted, this would bump to 2.
    expect(instanceAfter).toBe(instanceBefore);
    // And the conversationId prop did flip to the new id.
    expect(after.getAttribute('data-conv-id')).toBe(CONV_ID);
    // The history hook must NOT have fetched — the id was already in
    // mintedIds by the time the pathname changed.
    expect(authFetchMock).not.toHaveBeenCalled();
  });

  // Cross-conversation navigation (e.g. user clicks a different sidebar
  // item) is EXPECTED to remount — the new conversation has different
  // initial messages and there's no in-flight WS to preserve. This test
  // pins that behavior.
  it('remounts MessageStream when the user navigates between two distinct conversations', async () => {
    setPathname(`/chat/${CONV_ID}`);
    stubHistory([], 0);
    const { rerender } = render(<ChatSurface />);
    await act(async () => {
      await Promise.resolve();
    });
    const firstId = screen
      .getByTestId('message-stream')
      .getAttribute('data-instance-id');

    setPathname(`/chat/${OTHER_CONV_ID}`);
    stubHistory([], 0);
    rerender(<ChatSurface />);
    await act(async () => {
      await Promise.resolve();
    });
    const secondId = screen
      .getByTestId('message-stream')
      .getAttribute('data-instance-id');

    expect(secondId).not.toBe(firstId);
  });
});

describe('ChatSurface — direct URL hit (refresh / paste-link)', () => {
  it('renders loading state then hydrates MessageStream with fetched history', async () => {
    setPathname(`/chat/${CONV_ID}`);
    stubHistory(
      [
        {
          id: 'm1',
          role: 'user',
          content: 'hello',
          status: 'complete',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'hi there',
          status: 'complete',
          provider: 'mock',
          model: 'mock-1',
        },
      ],
      3,
    );
    render(<ChatSurface />);
    expect(screen.getByTestId('chat-surface-loading')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    const ms = screen.getByTestId('message-stream');
    expect(ms.getAttribute('data-initial-len')).toBe('2');
  });

  it('renders an error state when the history fetch rejects', async () => {
    setPathname(`/chat/${CONV_ID}`);
    authFetchMock.mockRejectedValueOnce(new Error('boom'));
    render(<ChatSurface />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('chat-surface-error')).toBeInTheDocument();
  });
});
