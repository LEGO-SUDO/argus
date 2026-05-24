// server-api-fetch — verifies that server-side fetches hit the BARE api
// path (no `/api` prefix), since the Next.js rewrite `/api/:path*` →
// `${apiOrigin}/:path*` does NOT execute for server-side requests. This is
// the regression guard for the "infinite redirect to /login" bug where
// /chat layout's getSessionUser() called /api/auth/session against the api,
// which has @Controller('auth') (no /api prefix) and 404'd.
//
// The `server-only` import in the consumer files is stripped at test time
// because we never import those consumers here — we import the helper
// module directly. (server-api-fetch.ts itself imports 'server-only' — see
// __mocks__ if the test runner barks; ts-jest + jsdom currently lets the
// no-op pass through.)

import { serverApiFetch } from '@/lib/server-api-fetch';
import { ApiError, AuthError } from '@/lib/auth-fetch';

const ORIGINAL_API_URL = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test:4000';
});

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = ORIGINAL_API_URL;
  jest.restoreAllMocks();
});

function mockFetch(response: {
  status?: number;
  ok?: boolean;
  json?: unknown;
  statusText?: string;
}) {
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  const fetchMock = jest.fn().mockResolvedValue({
    status,
    ok,
    statusText: response.statusText ?? '',
    json: async () => response.json,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
  return fetchMock;
}

describe('serverApiFetch — URL composition', () => {
  it('appends the BARE path to apiBaseUrl (no /api prefix)', async () => {
    const fetchMock = mockFetch({ json: { userId: 'u1' } });
    await serverApiFetch('/auth/session', { cookieHeader: 'sid=abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    // CRITICAL: server-side URL must NOT contain `/api/auth/session` —
    // the api controllers are mounted at `/auth/...` directly.
    expect(url).toBe('http://api.test:4000/auth/session');
    expect(url).not.toContain('/api/auth/session');
  });

  it('forwards the Cookie header so the api sees the session', async () => {
    const fetchMock = mockFetch({ json: {} });
    await serverApiFetch('/auth/session', { cookieHeader: 'sid=xyz' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Cookie).toBe('sid=xyz');
  });

  it('normalises an accidentally-prefixed /api path by stripping it', async () => {
    // Defense-in-depth — a caller migration that forgets to drop /api should
    // still land at the right URL, not double-prefix it.
    const fetchMock = mockFetch({ json: {} });
    await serverApiFetch('/api/conversations', { cookieHeader: 'sid=abc' });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test:4000/conversations');
  });
});

describe('serverApiFetch — error mapping', () => {
  it('throws AuthError on 401', async () => {
    mockFetch({ status: 401, ok: false });
    await expect(
      serverApiFetch('/auth/session', { cookieHeader: 'sid=expired' }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ApiError on 500 with the parsed code+message', async () => {
    mockFetch({
      status: 500,
      ok: false,
      json: { error: { code: 'internal', message: 'boom' } },
    });
    try {
      await serverApiFetch('/conversations', { cookieHeader: 'sid=ok' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).code).toBe('internal');
      expect((err as ApiError).message).toBe('boom');
    }
  });
});
