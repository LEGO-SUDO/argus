// AuthController — GET /auth/session.
//
// Tight-scope round 3: cover the new session-hydration endpoint end-to-end
// at the controller layer (SessionGuard is exercised separately in
// session.guard.test.ts). The 401 / 200 pair maps directly to the contract
// the web app's `serverApiFetch('/auth/session')` depends on.
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { SessionGuard, type AuthenticatedRequest } from '../../src/auth/session.guard';
import { SESSION_COOKIE_NAME } from '../../src/common/session-cookie';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function fakeAuth(stub: Partial<AuthService>): AuthService {
  return stub as AuthService;
}

function buildRes(): Response & { _headers: Record<string, string | string[]> } {
  const headers: Record<string, string | string[]> = {};
  const res = {
    _headers: headers,
    setHeader(name: string, value: string | string[]): Response {
      headers[name] = value;
      return res as unknown as Response;
    },
  };
  return res as unknown as Response & { _headers: Record<string, string | string[]> };
}

function buildExecutionCtx(
  req: Partial<AuthenticatedRequest> & { cookies?: Record<string, string> },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthController.session', () => {
  it('SessionGuard rejects requests with no cookie (401)', async () => {
    // The guard is what enforces the 401 — the controller method never runs.
    // We assert the guard contract here so a regression in either layer
    // surfaces as a failing test for the session-hydration flow.
    const guard = new SessionGuard(fakeAuth({ findUserBySessionToken: async () => null }));
    const ctx = buildExecutionCtx({ cookies: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('SessionGuard rejects requests whose cookie does not resolve to a session (401)', async () => {
    const guard = new SessionGuard(fakeAuth({ findUserBySessionToken: async () => null }));
    const ctx = buildExecutionCtx({
      cookies: { [SESSION_COOKIE_NAME]: 'bogus-token' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns { userId, email } when the cookie validates and the user exists', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const controller = new AuthController(
      fakeAuth({
        getUserById: async (id: string) =>
          id === userId ? { id: userId, email: 'alice@example.com' } : null,
      }),
    );
    const req = { user: { id: userId } } as AuthenticatedRequest;
    const res = buildRes();
    const result = await controller.session(req, res);
    expect(result).toEqual({ userId, email: 'alice@example.com' });
    // No Set-Cookie on the happy path — we don't refresh the cookie on
    // session reads (the repository handles sliding-window expiresAt).
    expect(res._headers['Set-Cookie']).toBeUndefined();
  });

  it('clears the cookie and throws 401 when the session is valid but the user has been deleted', async () => {
    const userId = '22222222-2222-2222-2222-222222222222';
    const controller = new AuthController(
      fakeAuth({ getUserById: async () => null }),
    );
    const req = { user: { id: userId } } as AuthenticatedRequest;
    const res = buildRes();
    await expect(controller.session(req, res)).rejects.toBeInstanceOf(UnauthorizedException);
    const setCookie = res._headers['Set-Cookie'];
    expect(typeof setCookie).toBe('string');
    expect(setCookie as string).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie as string).toMatch(/Max-Age=0/i);
  });

  it('throws 401 when req.user is missing (defense-in-depth past the guard)', async () => {
    const controller = new AuthController(fakeAuth({ getUserById: async () => null }));
    const req = {} as AuthenticatedRequest;
    const res = buildRes();
    await expect(controller.session(req, res)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
