// ChatSidebar — the full 260px chat-side column wires brand mark +
// persistent "+ New conversation" button + grouped list + user-chip.
//
// We focus on the wiring (not the inner components, which have their own
// tests): the sidebar must render the new-conversation button with the
// kbd hint EVEN WHEN there are existing conversations, and the user-chip
// must always render at the foot.
import { render, screen } from '@testing-library/react';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import type { ConversationDto } from '@argus/contracts';

jest.mock('next/navigation', () => ({
  usePathname: () => '/chat',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

describe('ChatSidebar', () => {
  it('always renders the New conversation button with the ⌘N kbd hint', () => {
    render(<ChatSidebar conversations={[]} userEmail="x@y.z" />);
    const newBtn = screen.getByTestId('chat-new-conversation');
    expect(newBtn).toBeInTheDocument();
    expect(newBtn).toHaveTextContent(/new conversation/i);
    expect(newBtn.querySelector('kbd')).toHaveTextContent('⌘N');
  });

  it('renders the New conversation button even with conversations present', () => {
    const convs: ConversationDto[] = [
      {
        id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
        title: 'Existing thread',
        createdAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
      },
    ];
    render(<ChatSidebar conversations={convs} userEmail="x@y.z" />);
    expect(screen.getByTestId('chat-new-conversation')).toBeInTheDocument();
    expect(screen.getByText(/existing thread/i)).toBeInTheDocument();
  });

  it('renders the user-chip foot with the supplied email', () => {
    render(<ChatSidebar conversations={[]} userEmail="alice@example.com" />);
    expect(screen.getByTestId('chat-user-chip')).toBeInTheDocument();
    expect(screen.getByTestId('chat-user-email')).toHaveTextContent('alice@example.com');
  });

  it('exposes the chat-sidebar testid the e2e suite targets', () => {
    render(<ChatSidebar conversations={[]} userEmail="x@y.z" />);
    expect(screen.getByTestId('chat-sidebar')).toBeInTheDocument();
  });
});
