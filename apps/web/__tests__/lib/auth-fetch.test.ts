// auth-fetch — verifies that browser-side fetches retain the `/api` prefix
// so the Next.js dev rewrite `/api/:path*` → `${apiOrigin}/:path*` forwards
// them to the api service. This is the client-side counterpart to the
// server-api-fetch test; together they guard the two-paths split.

import { authFetch, ApiError, AuthError } from '@/lib/auth-fetch';

const ORIGINAL_API_URL = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  // Same-origin default — apiBaseUrl returns '' so the URL the browser sees
  // is just the path. That's what we want — the rewrite handles the rest.
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = ORIGINAL_API_URL;
  jest.restoreAllMocks();
});

function mockFetch(response: {
  status?: number;
  ok?: boolean;
  json?: unknown;
}) {
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  const fetchMock = jest.fn().mockResolvedValue({
    status,
    ok,
    statusText: '',
    json: async () => response.json,
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    configurable: true,
    writable: true,
  });
  return fetchMock;
}

describe('authFetch — URL composition (browser)', () => {
  it('preserves the /api prefix on the path', async () => {
    const fetchMock = mockFetch({ json: { userId: 'u1' } });
    await authFetch('/api/auth/login', { method: 'POST', body: { email: 'a', password: 'b' } });
    const [url] = fetchMock.mock.calls[0]!;
    // Browser-side: we keep `/api/...` so the Next.js rewrite catches it.
    expect(url).toBe('/api/auth/login');
  });

  it('uses NEXT_PUBLIC_API_URL when set, still preserving /api', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    const fetchMock = mockFetch({ json: {} });
    await authFetch('/api/conversations');
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/api/conversations');
  });

  it('sends credentials: include so the session cookie travels', async () => {
    const fetchMock = mockFetch({ json: {} });
    await authFetch('/api/auth/session');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe('include');
  });
});

describe('authFetch — error mapping', () => {
  it('throws AuthError on 401', async () => {
    mockFetch({ status: 401, ok: false });
    await expect(authFetch('/api/auth/session')).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ApiError with status and parsed code on 4xx/5xx', async () => {
    mockFetch({
      status: 409,
      ok: false,
      json: { error: { code: 'email_taken', message: 'taken' } },
    });
    try {
      await authFetch('/api/auth/signup', { method: 'POST', body: { email: 'x' } });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).code).toBe('email_taken');
    }
  });
});
