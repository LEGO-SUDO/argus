// server-api-fetch — server-only thin wrapper over fetch that talks directly
// to the api service. Distinct from `authFetch` (browser-facing) because the
// Next.js rewrite `/api/:path*` -> `${apiOrigin}/:path*` ONLY runs for
// browser requests routed through the Next dev/server. Server components
// fetching from inside `getServerSideProps` / RSC fetch bypass the rewrite
// entirely, so they must hit the api at its bare path (no `/api` prefix —
// the api controllers are mounted at root paths like `/auth`, `/conversations`).
//
// LLD note: the conceptual split between `client-api-fetch` and
// `server-api-fetch` was always implied — this file is the explicit
// server-side surface so callers don't have to remember to strip `/api` by
// hand. Callers pass the *bare* api path (e.g. `/auth/session`, not
// `/api/auth/session`).

import 'server-only';

import { apiBaseUrl, ApiError, AuthError } from './auth-fetch';

export type ServerApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Forward the incoming request's `Cookie` header so the api sees the
   * session. Server components resolve this via
   * `server-session.sessionCookieHeader()`.
   */
  cookieHeader?: string;
  /** Override base URL (defaults to `apiBaseUrl()`). */
  baseUrl?: string;
};

/**
 * Fetch from the api using the *bare* api path (no `/api` prefix).
 *
 * Example:
 *   serverApiFetch('/auth/session')   // hits ${apiBaseUrl}/auth/session
 *   serverApiFetch('/conversations')  // hits ${apiBaseUrl}/conversations
 *
 * Use `authFetch` from `auth-fetch.ts` for browser code, where the path
 * starts with `/api/...` and the Next rewrite forwards to the api.
 */
export async function serverApiFetch<T = unknown>(
  bareApiPath: string,
  options: ServerApiFetchOptions = {},
): Promise<T> {
  const { method = 'GET', body, cookieHeader, baseUrl } = options;

  // Defense-in-depth: if a caller accidentally passes `/api/...`, strip it.
  // The intent of this helper is "bare path"; logging would be appropriate
  // if we had a logger plumbed here. Quietly normalise instead of throwing
  // because every alternative (throw, redirect, 500) is worse for the user.
  const normalised = bareApiPath.startsWith('/api/')
    ? bareApiPath.slice('/api'.length)
    : bareApiPath;

  // Server-side: use INTERNAL_API_URL (compose: http://api:4000) which
  // resolves via the container network. NEXT_PUBLIC_API_URL is the browser-
  // visible URL and would resolve to the wrong host inside the web container.
  // Fall back to localhost for hybrid-dev mode where the api runs locally.
  const serverBase = process.env.INTERNAL_API_URL || apiBaseUrl() || 'http://localhost:4000';
  const url = (baseUrl ?? serverBase) + normalised;

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
    // Server-side fetch has no implicit cookie jar; cookies travel via the
    // explicit `Cookie` header above.
    cache: 'no-store',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    throw new AuthError('unauthenticated', 401);
  }
  if (!res.ok) {
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
