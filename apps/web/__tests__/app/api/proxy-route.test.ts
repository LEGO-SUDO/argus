/**
 * @jest-environment node
 */
import { POST } from '@/app/api/[...path]/route';

const ORIGINAL_INTERNAL_API_URL = process.env.INTERNAL_API_URL;
const ORIGINAL_API_URL = process.env.API_URL;
const ORIGINAL_NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  process.env.INTERNAL_API_URL = ORIGINAL_INTERNAL_API_URL;
  process.env.API_URL = ORIGINAL_API_URL;
  process.env.NEXT_PUBLIC_API_URL = ORIGINAL_NEXT_PUBLIC_API_URL;
  Object.defineProperty(process.env, 'NODE_ENV', {
    value: ORIGINAL_NODE_ENV,
    configurable: true,
    writable: true,
  });
  jest.restoreAllMocks();
});

function routeContext(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

describe('/api catch-all proxy route', () => {
  it('forwards /api/auth/login to the bare API /auth/login path', async () => {
    process.env.INTERNAL_API_URL = 'https://api.argus.test/';
    delete process.env.API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ userId: 'u1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    const req = new Request('https://web.argus.test/api/auth/login?next=chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'argus_session=token',
      },
      body: JSON.stringify({ email: 'demo@argus.dev', password: 'let-me-in-9' }),
    });

    const res = await POST(req as never, routeContext(['auth', 'login']) as never);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe('https://api.argus.test/auth/login?next=chat');
    expect(init.method).toBe('POST');
    expect(init.headers.get('cookie')).toBe('argus_session=token');
  });

  it('falls back to the hardcoded prod API origin when no env var is set', async () => {
    // With no INTERNAL_API_URL/API_URL/NEXT_PUBLIC_API_URL, production uses the
    // hardcoded fallback so the proxy keeps working even if Vercel doesn't
    // surface the env var (the 502 "api_origin_missing" branch is now only
    // reachable if the hardcoded fallback were ever emptied).
    delete process.env.INTERNAL_API_URL;
    delete process.env.API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
    });

    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });

    const res = await POST(
      new Request('https://web.argus.test/api/auth/login', { method: 'POST' }) as never,
      routeContext(['auth', 'login']) as never,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe('https://api-argus.duckdns.org/auth/login');
  });
});
