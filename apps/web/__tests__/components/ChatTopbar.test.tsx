// ChatTopbar — sticky bar with conversation title on the left + Phase B
// surface-switch slot on the right.
//
// The title is resolved from the path (matching /chat/<uuid>) against the
// conversation list, so we exercise both the "no active conversation"
// (says "New conversation") and the "conversation selected" (renders the
// title in bold) paths.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatTopbar } from '@/components/chat/ChatTopbar';
import type { ConversationDto } from '@argus/contracts';

const ACTIVE_ID = '11111111-1111-4111-8111-aaaaaaaaaaaa';
let mockPath = '/chat';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
}));

const conversations: ConversationDto[] = [
  {
    id: ACTIVE_ID,
    title: 'My active thread',
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
  },
];

describe('ChatTopbar', () => {
  beforeEach(() => {
    mockPath = '/chat';
  });

  it('renders "New conversation" when no active conversation is in the path', () => {
    render(<ChatTopbar conversations={conversations} />);
    expect(screen.getByTestId('chat-topbar-title')).toHaveTextContent(
      /new conversation/i,
    );
  });

  it('renders the conversation title in bold when one is active', () => {
    mockPath = `/chat/${ACTIVE_ID}`;
    render(<ChatTopbar conversations={conversations} />);
    const title = screen.getByTestId('chat-topbar-title');
    expect(title.textContent).toMatch(/conversation:/i);
    expect(title.textContent).toMatch(/my active thread/i);
    // The title text proper is rendered in a <b> so we can assert the
    // visual weight matches the design intent.
    expect(title.querySelector('b')).toHaveTextContent('My active thread');
  });

  it('exposes a Phase B surface-switch slot for the forthcoming console pill', () => {
    render(<ChatTopbar conversations={conversations} />);
    expect(
      screen.getByTestId('chat-topbar-surface-switch-slot'),
    ).toBeInTheDocument();
  });

  it('renders the mobile menu button only when onMobileMenuClick is provided', () => {
    const { rerender } = render(<ChatTopbar conversations={conversations} />);
    expect(screen.queryByTestId('chat-topbar-mobile-menu')).toBeNull();

    const onClick = jest.fn();
    rerender(
      <ChatTopbar conversations={conversations} onMobileMenuClick={onClick} />,
    );
    const btn = screen.getByTestId('chat-topbar-mobile-menu');
    expect(btn).toBeInTheDocument();
  });

  it('invokes the mobile menu callback on click', async () => {
    const onClick = jest.fn();
    render(
      <ChatTopbar conversations={conversations} onMobileMenuClick={onClick} />,
    );
    await userEvent.click(screen.getByTestId('chat-topbar-mobile-menu'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
