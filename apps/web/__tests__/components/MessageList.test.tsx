// MessageList — visual fidelity tests for the rebuilt message log:
//   - Both roles left-aligned (no right-align for user)
//   - User bubble uses bg-chat-panel (NOT bg-acc-soft)
//   - Assistant body is unwrapped prose (no card padding)
//   - Provider chip carries a colored swatch keyed off `data-prov`
//   - Provider + model testids the e2e suite needs are present
//   - Canceled marker uses `data-testid="message-status-canceled"`
//   - Hover-actions row exists for assistant messages
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageList } from '@/components/chat/MessageList';
import type { Message } from '@/lib/message-stream-reducer';

function userMsg(id: string, content: string): Message {
  return { id, role: 'user', content, status: 'complete' };
}
function assistantMsg(partial: Partial<Message> & { id: string; content: string }): Message {
  return {
    role: 'assistant',
    status: 'complete',
    provider: 'mock',
    model: 'mock-1',
    ...partial,
  };
}

describe('MessageList — layout', () => {
  it('renders user + assistant rows with the expected role testids', () => {
    const messages: Message[] = [
      userMsg('m-user-1', 'hello'),
      assistantMsg({ id: 'm-asst-1', content: 'hi there' }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    expect(screen.getByTestId('message-row-user')).toBeInTheDocument();
    expect(screen.getByTestId('message-row-assistant')).toBeInTheDocument();
  });

  it('user bubble uses bg-chat-panel (NOT bg-acc-soft) per the design', () => {
    const messages: Message[] = [userMsg('m-user-1', 'hello')];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    const bubble = screen.getByTestId('message-bubble-m-user-1');
    expect(bubble.className).toMatch(/bg-chat-panel/);
    expect(bubble.className).not.toMatch(/bg-acc-soft/);
  });
});

describe('MessageList — assistant provider chip', () => {
  it('renders the provider chip with a colored swatch keyed off data-prov', () => {
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: 'ok', provider: 'anthropic', model: 'claude' }),
    ];
    const { container } = render(
      <MessageList messages={messages} onRetry={() => undefined} />,
    );
    const chip = container.querySelector('.prov[data-prov="anthropic"]');
    expect(chip).not.toBeNull();
    // The swatch dot is the .prov .swatch — its background color is bound to
    // the data-prov attribute via the global stylesheet.
    expect(chip!.querySelector('.swatch')).not.toBeNull();
  });

  it('exposes provider + model via the testids the e2e suite needs', () => {
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: 'ok', provider: 'openai', model: 'gpt-4' }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    const provider = screen.getByTestId('message-stream-provider');
    expect(provider).toHaveTextContent(/openai/i);
    const model = screen.getByTestId('message-stream-model');
    expect(model).toHaveTextContent(/gpt-4/i);
  });
});

describe('MessageList — terminal states', () => {
  it('canceled message renders the `message-status-canceled` marker', () => {
    const messages: Message[] = [
      assistantMsg({
        id: 'm-asst-1',
        content: 'partial...',
        status: 'canceled',
        provider: 'mock',
        model: 'mock-1',
      }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    expect(screen.getByTestId('message-status-canceled')).toHaveTextContent(/interrupted/i);
  });

  it('failed + canRetry renders Retry with the canonical testid + label', () => {
    const messages: Message[] = [
      userMsg('m-user-1', 'asked'),
      assistantMsg({
        id: 'm-asst-1',
        content: 'oops',
        status: 'failed',
        canRetry: true,
        errorCode: 'provider_error',
      }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    expect(screen.getByTestId('message-retry-m-asst-1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /retry/i }),
    ).toBeInTheDocument();
  });

  it('client_disconnected (interrupted) renders the canceled marker too', () => {
    const messages: Message[] = [
      assistantMsg({
        id: 'm-asst-1',
        content: 'partial...',
        status: 'failed',
        canRetry: true,
        errorCode: 'client_disconnected',
      }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    expect(screen.getByTestId('message-status-canceled')).toBeInTheDocument();
  });
});

describe('MessageList — hover actions', () => {
  it('renders the hover-actions row for assistant messages', () => {
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: 'ok' }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    expect(screen.getByTestId('message-actions-m-asst-1')).toBeInTheDocument();
    expect(screen.getByTestId('message-action-view-trace-m-asst-1')).toBeInTheDocument();
    expect(screen.getByTestId('message-action-copy-m-asst-1')).toBeInTheDocument();
  });

  // Task 80-81 — copy action must source the RAW Markdown source
  // (message.content), not the rendered DOM text. The bubble now renders
  // Markdown via MessageContent, so a naive innerText read would lose the
  // `**` markers.
  it('copies the raw Markdown source (message.content), not the rendered text', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: '**bold** answer' }),
    ];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    await userEvent.click(screen.getByTestId('message-action-copy-m-asst-1'));
    expect(writeText).toHaveBeenCalledWith('**bold** answer');
  });

  // Bug fix: the copy action gave no confirmation. After a successful write
  // the button surfaces a "copied" state so the user knows it worked.
  it('shows a "copied" confirmation after a successful copy', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const messages: Message[] = [assistantMsg({ id: 'm-asst-1', content: 'hi' })];
    render(<MessageList messages={messages} onRetry={() => undefined} />);
    const btn = screen.getByTestId('message-action-copy-m-asst-1');
    expect(btn).toHaveTextContent(/copy/i);
    expect(btn).not.toHaveTextContent(/copied/i);
    await userEvent.click(btn);
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  // Bug fix: "view trace" was a Phase B no-op. It now deep-links into the
  // operator console's Traces lens filtered to this conversation.
  it('renders view-trace as a console deep-link when a conversationId is provided', () => {
    const messages: Message[] = [assistantMsg({ id: 'm-asst-1', content: 'ok' })];
    render(
      <MessageList
        messages={messages}
        onRetry={() => undefined}
        conversationId="conv-123"
      />,
    );
    const link = screen.getByTestId('message-action-view-trace-m-asst-1');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute(
      'href',
      '/console/traces?conversationId=conv-123',
    );
    // Opens in a new tab (with safe rel).
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('MessageList — resume on canceled turns', () => {
  it('renders a Resume button on a canceled message and calls onResume', async () => {
    const onResume = jest.fn();
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: 'partial...', status: 'canceled' }),
    ];
    render(
      <MessageList
        messages={messages}
        onRetry={() => undefined}
        onResume={onResume}
      />,
    );
    const btn = screen.getByTestId('message-resume-m-asst-1');
    await userEvent.click(btn);
    expect(onResume).toHaveBeenCalledWith('m-asst-1');
  });

  it('does NOT render Resume on a completed message', () => {
    const messages: Message[] = [
      assistantMsg({ id: 'm-asst-1', content: 'done', status: 'complete' }),
    ];
    render(
      <MessageList
        messages={messages}
        onRetry={() => undefined}
        onResume={() => undefined}
      />,
    );
    expect(screen.queryByTestId('message-resume-m-asst-1')).toBeNull();
  });
});
