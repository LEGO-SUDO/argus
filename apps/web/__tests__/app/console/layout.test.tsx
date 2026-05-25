// Tests for the /console layout auth gate (LLD Reviewer Concern: the
// logged-out redirect was previously manual-only).
//
// The layout is an async server component; we mock the session resolver + the
// next/navigation redirect and assert the redirect decision (we don't render
// the returned tree, which depends on client-only providers).
jest.mock('@/lib/server-session', () => ({ getSessionUser: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));

import { getSessionUser } from '@/lib/server-session';
import { redirect } from 'next/navigation';
import ConsoleLayout from '@/app/console/layout';

const mockGetSessionUser = getSessionUser as jest.Mock;
const mockRedirect = redirect as unknown as jest.Mock;

beforeEach(() => {
  mockGetSessionUser.mockReset();
  mockRedirect.mockReset();
});

describe('/console layout auth gate (Task 170)', () => {
  it('redirects unauthenticated requests to /login', async () => {
    mockGetSessionUser.mockResolvedValue(null);
    await ConsoleLayout({ children: null });
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('does not redirect an authenticated user', async () => {
    mockGetSessionUser.mockResolvedValue({ userId: 'u-1' });
    await ConsoleLayout({ children: null });
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
