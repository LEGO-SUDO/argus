// server-session — server-only helper that resolves the session cookie to a
// user via the api's /auth/session endpoint.
//
// LLD Task 49. Returns `null` on missing/invalid so layouts can branch into
// a redirect without re-implementing the auth check per route. Marked
// server-only via `import 'server-only'` so it's a compile error if a client
// component pulls this in.

import 'server-only';
import { cookies } from 'next/headers';

import { AuthError } from './auth-fetch';
import { serverApiFetch } from './server-api-fetch';

export type SessionUser = {
  userId: string;
  email?: string;
};

/**
 * Resolve the current session to a user. Returns null when:
 *  - there is no session cookie
 *  - the api rejects the cookie (401)
 *  - the api is unreachable (caller should still treat as unauthenticated
 *    rather than blowing up the render)
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Next.js 15: cookies() is async and returns a Promise<ReadonlyRequestCookies>.
  const store = await cookies();
  // Serialize every cookie we have — the api validates the session one and
  // ignores the rest. This avoids hardcoding the session cookie name here
  // (the api owns the name).
  const cookieHeader = store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookieHeader) {
    return null;
  }
  try {
    // BARE api path — server-side requests bypass the Next rewrite that
    // would otherwise strip `/api`. See lib/server-api-fetch.ts for the
    // rationale.
    const user = await serverApiFetch<SessionUser>('/auth/session', {
      method: 'GET',
      cookieHeader,
    });
    return user;
  } catch (err) {
    if (err instanceof AuthError) {
      return null;
    }
    // Network / unexpected failure — treat as unauthenticated. This is
    // deliberately silent because logging an "auth check failed" warning on
    // every page render is noisier than it is useful; observability is
    // expected to come from the api side.
    return null;
  }
}

/**
 * Convenience: get the session cookie header for forwarding to api calls
 * from a Server Component. Returns an empty string when there are no
 * cookies so callers can pass it unconditionally.
 */
export async function sessionCookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
