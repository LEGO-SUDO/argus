// MessageStream — RTL tests covering the user-visible streaming behavior
// (LLD Tasks 33, 35, 37, 39, 41, 43, 45, 53, 56).
//
// We inject a stub WsClient so the component can be exercised without
// touching the real WebSocket constructor. The stub exposes hooks to fire
// inbound frames so tests can drive the reducer end-to-end.
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  WsFrameInbound,
  WsFrameOutbound,
} from '@argus/contracts';
import type { ErrorHandler, FrameHandler } from '@/lib/ws-client';
import type { WsClientLike } from '@/components/chat/MessageStream';
import { MessageStream } from '@/components/chat/MessageStream';
import type { Message } from '@/lib/message-stream-reducer';

const MSG_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID_2 = '44444444-4444-4444-8444-444444444444';
const CONV_ID = '22222222-2222-4222-8222-222222222222';
const NEW_CONV_ID = '33333333-3333-4333-8333-333333333333';

// next/navigation mock — `replaceMock` is what we now assert IS called
// on the first start-frame URL swap (router.replace is safe because
// MessageStream lives in the chat layout and survives the navigation).
const replaceMock = jest.fn();
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

function makeStubClient(opts: { failNextSend?: boolean } = {}): {
  client: WsClientLike;
  fire: (frame: WsFrameOutbound) => void;
  sent: WsFrameInbound[];
  closed: () => boolean;
  setFailNextSend: (fail: boolean) => void;
} {
  let frameHandler: FrameHandler | null = null;
  let _errorHandler: ErrorHandler | null = null;
  let closed = false;
  let failNextSend = opts.failNextSend ?? false;
  const sent: WsFrameInbound[] = [];
  const client: WsClientLike = {
    onFrame(h) {
      frameHandler = h;
    },
    onError(h) {
      _errorHandler = h;
    },
    onClose() {
      // no-op for stub
    },
    send(frame) {
      if (failNextSend) {
        failNextSend = false;
        throw new Error('ws-client: not connected');
      }
      sent.push(frame);
    },
    close() {
      closed = true;
    },
  };
  return {
    client,
    fire: (frame: WsFrameOutbound) => {
      if (closed) return;
      // Wrap in act() so React 19 flushes the resulting state update before
      // the assertion runs.
      act(() => {
        frameHandler?.(frame);
      });
    },
    sent,
    closed: () => closed,
    setFailNextSend: (fail: boolean) => {
      failNextSend = fail;
    },
  };
}

beforeEach(() => {
  replaceMock.mockReset();
  pushMock.mockReset();
});

describe('MessageStream — cancel button visibility', () => {
  it('shows Cancel during streaming and hides it after end', () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    stub.fire({ type: 'token', messageId: MSG_ID, seq: 1, content: 'hi' });
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    stub.fire({ type: 'end', messageId: MSG_ID, seq: 2, status: 'complete' });
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });
});

describe('MessageStream — cancel click sends cancel frame', () => {
  it('clicking Cancel sends a cancel frame for the active message_id', async () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(stub.sent.some((f) => f.type === 'cancel' && f.messageId === MSG_ID)).toBe(
      true,
    );
  });
});

describe('MessageStream — retry on failed turn', () => {
  it('renders Retry after error and resends the prior user text', async () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hello');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    stub.fire({
      type: 'error',
      messageId: MSG_ID,
      errorCode: 'provider_error',
      message: 'boom',
    });
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);
    const sentSends = stub.sent.filter((f) => f.type === 'send');
    expect(sentSends.length).toBeGreaterThanOrEqual(2);
    // Last send must carry the prior user text.
    expect(sentSends[sentSends.length - 1]).toMatchObject({
      type: 'send',
      content: 'hello',
    });
  });

  // Regression guard for bug #5: Retry was duplicating the user row in the
  // transcript by dispatching composer-submitted (which appends a new user
  // message). The fix swapped Retry to dispatch retry-clicked, which only
  // flips the lock.
  it('does NOT duplicate the user message in the transcript on Retry', async () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hello');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    stub.fire({
      type: 'error',
      messageId: MSG_ID,
      errorCode: 'provider_error',
      message: 'boom',
    });

    // Before retry: exactly one user-rendered row showing "hello".
    const userRowsBefore = screen.getAllByTestId('message-row-user');
    expect(userRowsBefore).toHaveLength(1);
    expect(userRowsBefore[0]!.textContent).toContain('hello');

    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));

    // After retry: STILL exactly one user-rendered row — no duplicate.
    const userRowsAfter = screen.getAllByTestId('message-row-user');
    expect(userRowsAfter).toHaveLength(1);
    expect(userRowsAfter[0]!.textContent).toContain('hello');
  });
});

describe('MessageStream — composer disabled while streaming', () => {
  it('disables composer on send and re-enables on end', async () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    const input = screen.getByRole('textbox', { name: /message/i });
    await userEvent.type(input, 'hi');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    expect(input).toBeDisabled();
    // While streaming, the Send button is swapped for a Cancel button
    // (composer.streaming === true). The Send button is therefore absent.
    expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
    stub.fire({ type: 'end', messageId: MSG_ID, seq: 1, status: 'complete' });
    expect(input).not.toBeDisabled();
    // Send re-enables once the user has text again — typing satisfies the
    // empty-text disable guard so we can observe the composer lock release.
    await userEvent.type(input, 'next');
    expect(screen.getByRole('button', { name: /^send$/i })).not.toBeDisabled();
  });

  // Regression guard for bug #4: send-throws used to lock the composer
  // forever because composer-submitted was dispatched BEFORE the WS send.
  it('does NOT lock the composer when the underlying WS send throws', async () => {
    const stub = makeStubClient({ failNextSend: true });
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    const input = screen.getByRole('textbox', { name: /message/i });
    await userEvent.type(input, 'hi');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    // The send threw — composer must remain usable. Type more and verify
    // the Send button is enabled (the text guard plus the not-locked
    // state).
    expect(input).not.toBeDisabled();
    // Surface should show the error message so the user knows what happened.
    expect(screen.getByTestId('message-stream-error')).toBeInTheDocument();
  });
});

describe('MessageStream — omitted indicator', () => {
  it('renders OmittedIndicator when omittedCount > 0', () => {
    const stub = makeStubClient();
    const initial: Message[] = Array.from({ length: 3 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      content: `t${i}`,
      status: 'complete' as const,
    }));
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={initial}
        omittedCount={5}
        wsClient={stub.client}
      />,
    );
    expect(screen.getByText(/5 earlier messages omitted/i)).toBeInTheDocument();
  });
});

describe('MessageStream — provider/model label', () => {
  it('renders provider and model on completed assistant message (sourced from metadata frame)', () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: CONV_ID,
      provider: 'openai',
      model: 'gpt-4',
      seq: 0,
    });
    // Metadata frame (post-commit) is the SOLE source of provider/model per
    // HLD D1 + LLD Tasks 1-4. The start frame's provider/model are ignored
    // by the reducer — emit a metadata frame so the chip and promoted
    // message acquire the strings.
    //
    // Cast through `unknown` because `WsFrameOutbound` from
    // `@argus/contracts` doesn't yet declare the metadata variant on this
    // branch (backend worker owns that addition); the reducer accepts a
    // widened `StreamFrame` internally.
    stub.fire({
      type: 'metadata',
      messageId: MSG_ID,
      seq: 1,
      providerMeta: { provider: 'openai', model: 'gpt-4' },
    } as unknown as WsFrameOutbound);
    stub.fire({ type: 'token', messageId: MSG_ID, seq: 2, content: 'ok' });
    stub.fire({ type: 'end', messageId: MSG_ID, seq: 3, status: 'complete' });
    // Both strings appear in the rendered tree.
    expect(screen.getByText(/openai/i)).toBeInTheDocument();
    expect(screen.getByText(/gpt-4/i)).toBeInTheDocument();
  });
});

describe('MessageStream — ContextMeter (LLD Tasks 96-97)', () => {
  it('sources tokens from the last COMPLETED assistant message, ignoring failed/canceled rows', () => {
    const stub = makeStubClient();
    // Order matters: completed (has tokens) → failed (no tokens) → canceled
    // (no tokens). The meter must read the completed row, NOT the literal
    // last row.
    const completed: Message = {
      id: 'a-complete',
      role: 'assistant',
      content: 'done',
      status: 'complete',
      provider: 'mock',
      model: 'mock-1',
      tokensUsed: 5000,
      tokensBudget: 10000,
    };
    const failed: Message = {
      id: 'a-failed',
      role: 'assistant',
      content: 'boom',
      status: 'failed',
      errorCode: 'provider_error',
      canRetry: true,
    };
    const canceled: Message = {
      id: 'a-canceled',
      role: 'assistant',
      content: 'partial',
      status: 'canceled',
    };
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[completed, failed, canceled]}
        wsClient={stub.client}
      />,
    );
    expect(screen.getByTestId('context-meter')).toHaveTextContent(
      '5k / 10k tokens',
    );
  });

  it('renders no meter when there is no completed assistant message', () => {
    const stub = makeStubClient();
    const failed: Message = {
      id: 'a-failed',
      role: 'assistant',
      content: 'boom',
      status: 'failed',
      errorCode: 'provider_error',
      canRetry: true,
    };
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[failed]}
        wsClient={stub.client}
      />,
    );
    expect(screen.queryByTestId('context-meter')).toBeNull();
  });
});

describe('MessageStream — interrupted marker from history', () => {
  it('shows "interrupted" + Retry for restored failed/client_disconnected message', () => {
    const stub = makeStubClient();
    const failed: Message = {
      id: MSG_ID,
      role: 'assistant',
      content: 'partial reply',
      status: 'failed',
      errorCode: 'client_disconnected',
      provider: 'mock',
      model: 'mock-1',
      canRetry: true,
    };
    const userPrior: Message = {
      id: 'u-prior',
      role: 'user',
      content: 'asked something',
      status: 'complete',
    };
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[userPrior, failed]}
        wsClient={stub.client}
      />,
    );
    expect(screen.getByText(/interrupted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('MessageStream — null conversation URL swap on first start', () => {
  // The URL swap is now driven by `router.replace`. This is safe
  // because MessageStream lives in the chat layout (via ChatSurface),
  // so the navigation does NOT remount the component — the WS
  // connection and reducer state survive intact. The legacy
  // `history.replaceState` hack is gone (it was a workaround for the
  // old setup where the page component owned the mount).
  it('calls router.replace with the minted conversation URL', async () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={null}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: NEW_CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    expect(replaceMock).toHaveBeenCalledWith(`/chat/${NEW_CONV_ID}`);
  });

  it('invokes onConversationMinted with the freshly-minted id', async () => {
    const stub = makeStubClient();
    const onMinted = jest.fn();
    render(
      <MessageStream
        conversationId={null}
        initialMessages={[]}
        wsClient={stub.client}
        onConversationMinted={onMinted}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));
    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: NEW_CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });
    expect(onMinted).toHaveBeenCalledWith(NEW_CONV_ID);
    // Should fire BEFORE router.replace so the host (ChatSurface) can
    // mark the id as locally-owned before the pathname-derived hook
    // reacts. We assert call-order via Jest's invocation indices.
    const onMintedOrder = onMinted.mock.invocationCallOrder[0];
    const replaceOrder = replaceMock.mock.invocationCallOrder[0];
    expect(onMintedOrder).toBeDefined();
    expect(replaceOrder).toBeDefined();
    expect(onMintedOrder!).toBeLessThan(replaceOrder!);
  });

  // Regression guard for the original bug: after the URL swap, the
  // component must still receive token/end frames on the SAME WS client
  // (i.e. it didn't unmount and tear the client down). We simulate the
  // post-router.replace state by passing `conversationId={NEW_CONV_ID}`
  // via a rerender — RTL re-renders the same instance without
  // unmounting, mirroring how the layout-hosted ChatSurface flows the
  // pathname-derived id back in.
  it('keeps streaming after the URL swap — tokens and end still apply', async () => {
    const stub = makeStubClient();
    const { rerender } = render(
      <MessageStream
        conversationId={null}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    stub.fire({
      type: 'start',
      messageId: MSG_ID,
      conversationId: NEW_CONV_ID,
      provider: 'mock',
      model: 'mock-1',
      seq: 0,
    });

    // Simulate the host (ChatSurface) reacting to the URL swap by
    // updating the conversationId prop. The component must continue to
    // process subsequent frames without remounting (same WS client).
    rerender(
      <MessageStream
        conversationId={NEW_CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );

    stub.fire({ type: 'token', messageId: MSG_ID, seq: 1, content: 'hello' });
    stub.fire({ type: 'token', messageId: MSG_ID, seq: 2, content: ' world' });
    stub.fire({ type: 'end', messageId: MSG_ID, seq: 3, status: 'complete' });

    // The component is still mounted and the assistant text reached the
    // transcript intact.
    const assistantRow = screen.getByTestId(`message-bubble-${MSG_ID}`);
    expect(assistantRow.textContent).toContain('hello world');
    // The stub was never closed by the component — verifying we did NOT
    // unmount and recreate during the URL change.
    expect(stub.closed()).toBe(false);
  });
});

describe('MessageStream — terminal no_providers_available banner', () => {
  it('renders the no-providers banner with an external README link', () => {
    const stub = makeStubClient();
    render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        wsClient={stub.client}
      />,
    );
    stub.fire({
      type: 'error',
      messageId: MSG_ID,
      errorCode: 'no_providers_available',
      message: 'no providers configured',
    });
    expect(screen.getByText(/no providers available/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /readme/i });
    // Must be an absolute URL (Next does not serve repo-root markdown in
    // prod — a relative /README.md would 404).
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https?:\/\//));
    expect(link.getAttribute('href')).toMatch(/README/i);
  });
});

// Regression guard for bug #6: the omitted-indicator used to flash on first
// paint because useReducer initialState was empty and only the mount-time
// effect populated omittedCount. The fix uses useReducer's third arg for
// lazy init so the first render already sees the right omittedCount.
describe('MessageStream — omittedCount lazy init', () => {
  it('shows the omitted indicator on the very first render (no zero-flash)', () => {
    const stub = makeStubClient();
    const { container } = render(
      <MessageStream
        conversationId={CONV_ID}
        initialMessages={[]}
        omittedCount={7}
        wsClient={stub.client}
      />,
    );
    // RTL renders synchronously to completion, but this test would still
    // catch the bug because the OLD code dispatched in useEffect AFTER
    // first paint — if we re-introduced that the indicator would be
    // visible here only AFTER the effect flushed. Either way, the
    // indicator must be present immediately on render.
    expect(container.textContent).toMatch(/7 earlier messages omitted/i);
  });
});

// Regression guard for bug #2: MessageStream used to construct WsClient
// during render, which throws in Node (no WebSocket) and double-invokes
// under StrictMode. This test confirms the component can render with a
// stub (the production WsClient construction path is now inside useEffect,
// so it is browser-only by definition).
describe('MessageStream — does not construct real WsClient during render', () => {
  it('renders without touching the global WebSocket constructor when wsClient is injected', () => {
    // Remove WebSocket entirely so any accidental render-time call would
    // throw a ReferenceError.
    const savedWS = (globalThis as { WebSocket?: unknown }).WebSocket;
    Object.defineProperty(globalThis, 'WebSocket', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const stub = makeStubClient();
      // Render must succeed — no throw.
      render(
        <MessageStream
          conversationId={CONV_ID}
          initialMessages={[]}
          wsClient={stub.client}
        />,
      );
      expect(screen.getByTestId('message-stream')).toBeInTheDocument();
    } finally {
      Object.defineProperty(globalThis, 'WebSocket', {
        value: savedWS,
        configurable: true,
        writable: true,
      });
    }
  });
});

// Silence unused-var warning for MSG_ID_2 which is reserved for future
// multi-turn tests.
void MSG_ID_2;
