// UserChip — avatar monogram + truncated email + icon-button logout.
//
// Verifies the design's `.chat-side .foot` shape: 26×26 avatar with white-on-ink
// initials, truncated email, and an iconbtn that posts to /api/auth/logout
// then redirects to /login.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserChip } from '@/components/chat/UserChip';

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
  }),
}));

describe('UserChip', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renders the avatar monogram from the first two characters of the email', () => {
    render(<UserChip email="alice@example.com" />);
    expect(screen.getByTestId('chat-user-avatar')).toHaveTextContent('AL');
    expect(screen.getByTestId('chat-user-email')).toHaveTextContent('alice@example.com');
  });

  it('exposes the logout button via the `logout-button` testid the e2e suite targets', () => {
    render(<UserChip email="alice@example.com" />);
    expect(screen.getByTestId('logout-button')).toBeInTheDocument();
  });

  it('POSTs to /api/auth/logout and redirects to /login on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    render(<UserChip email="alice@example.com" />);
    await userEvent.click(screen.getByTestId('logout-button'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  it('treats 401 as already-logged-out and redirects rather than surfacing an error', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
    render(<UserChip email="alice@example.com" />);
    await userEvent.click(screen.getByTestId('logout-button'));
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  it('falls back to "??" when the email is empty', () => {
    render(<UserChip email="" />);
    expect(screen.getByTestId('chat-user-avatar')).toHaveTextContent('??');
  });
});
