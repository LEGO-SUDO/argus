// Tasks 11+12 (RED) / 13 (GREEN) — SessionGuard.
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../../src/auth/session.guard';
import { SESSION_COOKIE_NAME } from '../../src/common/session-cookie';
import type { AuthService } from '../../src/auth/auth.service';

function buildCtx(req: Partial<AuthenticatedRequest> & { cookies?: Record<string, string> }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function fakeAuth(stub: Partial<AuthService>): AuthService {
  return stub as AuthService;
}

describe('SessionGuard', () => {
  it('throws Unauthorized when no session cookie is present', async () => {
    const guard = new SessionGuard(fakeAuth({ findUserBySessionToken: async () => null }));
    const ctx = buildCtx({ cookies: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws Unauthorized when the cookie does not map to a session', async () => {
    const guard = new SessionGuard(fakeAuth({ findUserBySessionToken: async () => null }));
    const ctx = buildCtx({ cookies: { [SESSION_COOKIE_NAME]: 'unknown-token' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns true and attaches req.user on a valid cookie', async () => {
    const guard = new SessionGuard(fakeAuth({ findUserBySessionToken: async () => 'user-123' }));
    const req: AuthenticatedRequest & { cookies?: Record<string, string> } = {
      cookies: { [SESSION_COOKIE_NAME]: 'good-token' },
    } as never;
    const ctx = buildCtx(req);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-123' });
  });
});
