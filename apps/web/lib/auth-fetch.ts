// auth-fetch — thin wrapper over fetch that forwards the session cookie and
// surfaces typed errors so route-level callers can branch without re-checking
// status codes.
//
// LLD Task 47. Used by:
//   - login/signup pages (browser-side; cookies via credentials: 'include')
//   - server-side conversations fetch (forwards the incoming session cookie
//     via the optional `cookieHeader` arg)
//
// The wrapper is intentionally tiny — it does NOT do retry/backoff (that's
// caller policy) and it does NOT parse arbitrary response shapes (returns
// the parsed JSON as `unknown`; callers narrow via zod or DTO types).

/** Thrown on 401 — callers redirect to /login. */
export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Thrown on non-2xx, non-401 responses. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export type AuthFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * When called from a Server Component, pass the incoming request's
   * `Cookie` header so the api sees the session. Browser callers can omit
   * this — `credentials: 'include'` handles it.
   */
  cookieHeader?: string;
  /** Override base URL (defaults to `NEXT_PUBLIC_API_URL` / same-origin). */
  baseUrl?: string;
};

export function apiBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && env.length > 0) return env;
  // Same-origin fallback so the next.config rewrite (`/api/* -> apps/api`)
  // works in dev without env config.
  return '';
}

export async function authFetch<T = unknown>(
  path: string,
  options: AuthFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, cookieHeader, baseUrl } = options;
  const url = (baseUrl ?? apiBaseUrl()) + path;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new AuthError('unauthenticated', 401);
  }
  if (!res.ok) {
    // Try to parse the contracts ErrorResponse shape — best-effort.
    let code: string | undefined;
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { error?: { code?: string; message?: string } };
      if (parsed?.error?.code) code = parsed.error.code;
      if (parsed?.error?.message) msg = parsed.error.message;
    } catch {
      // Body wasn't JSON — keep the default message.
    }
    throw new ApiError(msg, res.status, code);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}
