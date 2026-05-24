// LogoutButton — click invokes the logout endpoint and redirects (LLD Task 23).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoutButton } from '@/components/chat/LogoutButton';

// `next/navigation` needs to be mocked because RTL renders outside Next.
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

describe('LogoutButton', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('POSTs to /api/auth/logout and redirects to /login', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/logout');
    expect(init).toMatchObject({ method: 'POST' });
    expect(pushMock).toHaveBeenCalledWith('/login');
  });

  // Regression guard for bug #7: a 401 from /api/auth/logout means the
  // session is already invalid server-side — the user wanted to be logged
  // out and now they are. Old behavior surfaced "could not log out" and
  // kept them on /chat, which is user-hostile.
  it('treats 401 as already-logged-out and redirects to /login', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));

    expect(pushMock).toHaveBeenCalledWith('/login');
    expect(screen.queryByTestId('logout-error')).toBeNull();
  });

  it('shows the error banner on a non-401 failure (5xx, network)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('logout-error')).toBeInTheDocument();
  });
});
