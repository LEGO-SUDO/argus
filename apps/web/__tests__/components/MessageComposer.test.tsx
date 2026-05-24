// MessageComposer — visual-fidelity behavior tests for the redesigned
// composer (sticky-bottom, pill chips, auto-grow, Send↔Cancel swap,
// kbd help row) PLUS the ProviderPicker wiring (Codex findings #1, #4 +
// STEP 3 coverage): legacy-pills-vs-picker, pin set/clear PATCH plumbing,
// pre-send hold-then-apply, optimistic update + rollback-on-failure, and the
// pin-fallback notice render/dismiss/no-reappear lifecycle.
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderCatalog } from '@/lib/providers-api';
import { ApiError } from '@/lib/auth-fetch';

// Mock the pin REST helpers + the cache-dismissal helper so we can assert the
// exact calls and drive success/failure without a network.
const patchPinMock = jest.fn();
const clearPinMock = jest.fn();
const clearNoticeMock = jest.fn();
jest.mock('@/lib/providers-api', () => {
  const actual = jest.requireActual('@/lib/providers-api') as object;
  return {
    __esModule: true,
    ...actual,
    patchConversationPin: (...args: unknown[]) => patchPinMock(...args),
    clearConversationPin: (...args: unknown[]) => clearPinMock(...args),
  };
});
jest.mock('@/lib/use-conversation-history', () => {
  const actual = jest.requireActual(
    '@/lib/use-conversation-history',
  ) as object;
  return {
    __esModule: true,
    ...actual,
    clearPinFallbackNotice: (...args: unknown[]) => clearNoticeMock(...args),
  };
});

import { MessageComposer } from '@/components/chat/MessageComposer';

const CONV_ID = '22222222-2222-4222-8222-222222222222';

const CATALOG: ProviderCatalog = {
  providers: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptPerMillion: 0.15,
      completionPerMillion: 0.6,
      contextWindow: 128000,
    },
    {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      promptPerMillion: 3,
      completionPerMillion: 15,
      contextWindow: 200000,
    },
  ],
};

beforeEach(() => {
  patchPinMock.mockReset();
  clearPinMock.mockReset();
  clearNoticeMock.mockReset();
  patchPinMock.mockResolvedValue(undefined);
  clearPinMock.mockResolvedValue(undefined);
});

describe('MessageComposer', () => {
  it('renders the testids the e2e suite targets + the design pill chips', () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    expect(screen.getByTestId('message-composer-wrap')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-input')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-send')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-help')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-provider-pill')).toBeInTheDocument();
    expect(screen.getByTestId('message-composer-providers-count')).toBeInTheDocument();
  });

  it('uses the "Message argus…" placeholder when idle', () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    const input = screen.getByTestId('message-composer-input');
    expect(input).toHaveAttribute('placeholder', 'Message argus…');
  });

  it('swaps placeholder when streaming', () => {
    render(
      <MessageComposer
        disabled
        streaming
        onSend={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const input = screen.getByTestId('message-composer-input');
    expect(input).toHaveAttribute(
      'placeholder',
      'Streaming response… cancel to send another',
    );
  });

  it('swaps Send for Cancel while streaming', () => {
    const onCancel = jest.fn();
    render(
      <MessageComposer
        disabled
        streaming
        onSend={() => undefined}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByTestId('message-composer-send')).toBeNull();
    expect(screen.getByTestId('message-stream-cancel')).toBeInTheDocument();
  });

  it('shows pluralized provider count', () => {
    const { rerender } = render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        providersConfigured={1}
      />,
    );
    expect(screen.getByTestId('message-composer-providers-count')).toHaveTextContent(
      /1 provider configured/i,
    );
    rerender(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        providersConfigured={3}
      />,
    );
    expect(screen.getByTestId('message-composer-providers-count')).toHaveTextContent(
      /3 providers configured/i,
    );
  });

  it('renders the kbd help row', () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    const help = screen.getByTestId('message-composer-help');
    expect(help.textContent).toMatch(/to send/i);
    expect(help.textContent).toMatch(/for newline/i);
    expect(help.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(3);
  });

  it('Enter without shift submits; Shift+Enter inserts newline', async () => {
    const onSend = jest.fn();
    render(<MessageComposer disabled={false} onSend={onSend} />);
    const input = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    await userEvent.type(input, 'hello');
    await userEvent.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');

    await userEvent.type(input, 'first');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await userEvent.type(input, 'second');
    expect(input.value).toBe('first\nsecond');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Send is disabled when input is empty or whitespace-only', async () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    const send = screen.getByTestId('message-composer-send');
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByTestId('message-composer-input'), '   ');
    expect(send).toBeDisabled();
  });

  it('grows the textarea height with content (auto-grow)', async () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    const input = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    // jsdom doesn't compute real scrollHeight (returns 0), so we mock it.
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      get: () => 120,
    });
    await userEvent.type(input, 'a longer message that should grow the textarea');
    // The effect clamps to min 44 / max 220 — with mocked scrollHeight=120
    // the resulting height should be 120px (within range).
    expect(input.style.height).toBe('120px');
  });
});

// ---------------------------------------------------------------------------
// ProviderPicker wiring — picker vs legacy pills (STEP 3).
// ---------------------------------------------------------------------------
describe('MessageComposer — ProviderPicker vs legacy pills', () => {
  it('renders the ProviderPicker when a catalog is supplied', () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
      />,
    );
    expect(screen.getByTestId('provider-picker-trigger')).toBeInTheDocument();
    // The legacy pills are gone when the picker is active.
    expect(screen.queryByTestId('message-composer-provider-pill')).toBeNull();
  });

  it('renders the legacy pills when no catalog is supplied', () => {
    render(<MessageComposer disabled={false} onSend={() => undefined} />);
    expect(screen.getByTestId('message-composer-provider-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-picker-trigger')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pin set/clear PATCH plumbing (Codex finding #1 + STEP 3).
// ---------------------------------------------------------------------------
describe('MessageComposer — pin set/clear with a conversation id', () => {
  it('calls patchConversationPin with the conversation id when a model is picked', async () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
      />,
    );
    await userEvent.click(screen.getByTestId('provider-picker-trigger'));
    await userEvent.click(
      screen.getByRole('option', { name: /gpt-4o-mini/i }),
    );
    await waitFor(() => {
      expect(patchPinMock).toHaveBeenCalledWith(CONV_ID, {
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      });
    });
  });

  it('calls clearConversationPin when Auto is chosen on a pinned conversation', async () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
        pinnedProvider="openai"
        pinnedModel="gpt-4o-mini"
      />,
    );
    await userEvent.click(screen.getByTestId('provider-picker-trigger'));
    await userEvent.click(screen.getByRole('option', { name: /^auto$/i }));
    await waitFor(() => {
      expect(clearPinMock).toHaveBeenCalledWith(CONV_ID);
    });
  });

  it('does NOT PATCH pre-send (null conversationId) — holds the pin locally then applies on mint', async () => {
    const { rerender } = render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={null}
        catalog={CATALOG}
      />,
    );
    await userEvent.click(screen.getByTestId('provider-picker-trigger'));
    await userEvent.click(
      screen.getByRole('option', { name: /gpt-4o-mini/i }),
    );
    // No PATCH yet — there is no conversation row to pin.
    expect(patchPinMock).not.toHaveBeenCalled();
    // The picker reflects the chosen pin even pre-send.
    expect(
      screen.getByTestId('provider-picker-trigger'),
    ).toHaveAccessibleName(/gpt-4o-mini/i);

    // The conversation is minted — the id flows in via the prop (same mount).
    await act(async () => {
      rerender(
        <MessageComposer
          disabled={false}
          onSend={() => undefined}
          conversationId={CONV_ID}
          catalog={CATALOG}
        />,
      );
      await Promise.resolve();
    });
    // The held pin is now applied with a PATCH carrying the minted id.
    await waitFor(() => {
      expect(patchPinMock).toHaveBeenCalledWith(CONV_ID, {
        pinnedProvider: 'openai',
        pinnedModel: 'gpt-4o-mini',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Optimistic update + rollback-on-failure + error notice (Codex finding #4).
// ---------------------------------------------------------------------------
describe('MessageComposer — optimistic pin rollback on PATCH failure', () => {
  it('shows the optimistic label, then rolls back + shows an error notice when the PATCH rejects', async () => {
    // Hold the rejection so we can observe the optimistic state BEFORE the
    // failure resolves (otherwise the rollback races the assertion).
    let rejectPatch: (e: unknown) => void = () => undefined;
    patchPinMock.mockReturnValueOnce(
      new Promise((_res, rej) => {
        rejectPatch = rej;
      }),
    );
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
      />,
    );
    const trigger = screen.getByTestId('provider-picker-trigger');
    expect(trigger).toHaveAccessibleName(/auto/i);
    await userEvent.click(trigger);
    await userEvent.click(
      screen.getByRole('option', { name: /gpt-4o-mini/i }),
    );
    // Optimistic: label flips immediately to the chosen model (PATCH pending).
    expect(screen.getByTestId('provider-picker-trigger')).toHaveAccessibleName(
      /gpt-4o-mini/i,
    );

    // Now reject — the label rolls back to Auto and an inline error appears.
    await act(async () => {
      rejectPatch(new ApiError('bad pin', 400, 'invalid_pin'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('pin-error-notice')).toBeInTheDocument();
    });
    expect(screen.getByTestId('provider-picker-trigger')).toHaveAccessibleName(
      /auto/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Pin-fallback notice lifecycle (STEP 3).
// ---------------------------------------------------------------------------
describe('MessageComposer — pin-fallback notice', () => {
  it('renders the notice from previouslyPinned { provider, model }', () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
        pinFallbackNotice={{ provider: 'openai', model: 'gpt-4o-mini' }}
      />,
    );
    const notice = screen.getByTestId('pin-fallback-notice');
    expect(notice).toHaveTextContent(/openai/);
    expect(notice).toHaveTextContent(/gpt-4o-mini/);
  });

  it('dismiss hides the notice and calls the cache-clear helper', async () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
        pinFallbackNotice={{ provider: 'openai', model: 'gpt-4o-mini' }}
      />,
    );
    await userEvent.click(screen.getByTestId('pin-fallback-notice-dismiss'));
    expect(clearNoticeMock).toHaveBeenCalledWith(CONV_ID);
    expect(screen.queryByTestId('pin-fallback-notice')).toBeNull();
  });

  it('does not render the notice when none is supplied', () => {
    render(
      <MessageComposer
        disabled={false}
        onSend={() => undefined}
        conversationId={CONV_ID}
        catalog={CATALOG}
      />,
    );
    expect(screen.queryByTestId('pin-fallback-notice')).toBeNull();
  });
});
