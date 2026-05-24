// Session cookie name + serialization constants.
//
// Per LLD Open Question (Session cookie name + max-age default): we pick
// `argus_sid` and 30 days to match the sessions.expires_at constant in
// auth.service.ts. Centralized here so the REST controller (Set-Cookie),
// the WS handshake parser, and the SessionGuard all agree.
import { serialize, parse } from 'cookie';

export const SESSION_COOKIE_NAME = 'argus_sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionCookieOptions {
  /** Set `Secure` flag — required in production over HTTPS. */
  secure: boolean;
}

export function buildSessionCookie(token: string, opts: SessionCookieOptions): string {
  return serialize(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function buildClearedSessionCookie(opts: SessionCookieOptions): string {
  return serialize(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: 0,
  });
}

/**
 * Extract the session cookie value from a raw `cookie` header.
 * Returns null on missing/empty/malformed.
 */
export function extractSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  try {
    const parsed = parse(cookieHeader);
    const value = parsed[SESSION_COOKIE_NAME];
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
