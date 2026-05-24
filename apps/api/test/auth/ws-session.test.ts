// Tasks 14 (RED) / 15 (GREEN) — resolveWsUser.
import { resolveWsUser } from '../../src/auth/ws-session';
import { SESSION_COOKIE_NAME } from '../../src/common/session-cookie';
import type { AuthService } from '../../src/auth/auth.service';

function fakeAuth(resolved: string | null): AuthService {
  return { findUserBySessionToken: async () => resolved } as unknown as AuthService;
}

describe('resolveWsUser', () => {
  it('returns userId when the cookie header contains a valid session token', async () => {
    const userId = await resolveWsUser(
      { cookie: `${SESSION_COOKIE_NAME}=valid-token; other=ignored` },
      fakeAuth('user-abc'),
    );
    expect(userId).toBe('user-abc');
  });

  it('returns null when the cookie header is missing', async () => {
    const userId = await resolveWsUser({}, fakeAuth('user-abc'));
    expect(userId).toBeNull();
  });

  it('returns null when the cookie header lacks the session cookie', async () => {
    const userId = await resolveWsUser({ cookie: 'other=x' }, fakeAuth('user-abc'));
    expect(userId).toBeNull();
  });

  it('returns null when the cookie value is unknown to AuthService', async () => {
    const userId = await resolveWsUser(
      { cookie: `${SESSION_COOKIE_NAME}=ghost-token` },
      fakeAuth(null),
    );
    expect(userId).toBeNull();
  });

  it('accepts cookie header arrays (some proxies forward as string[])', async () => {
    const userId = await resolveWsUser(
      { cookie: [`${SESSION_COOKIE_NAME}=valid-token`] },
      fakeAuth('user-abc'),
    );
    expect(userId).toBe('user-abc');
  });
});
