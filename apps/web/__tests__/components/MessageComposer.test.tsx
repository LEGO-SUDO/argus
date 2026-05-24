// MessageComposer — visual-fidelity behavior tests for the redesigned
// composer (sticky-bottom, pill chips, auto-grow, Send↔Cancel swap,
// kbd help row).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageComposer } from '@/components/chat/MessageComposer';

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
