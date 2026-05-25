// WS handshake → userId resolver.
//
// Resolves the session two ways, in order:
//   1. `?token=` on the handshake URL — for cross-origin browsers (web on a
//      different domain than the api) that can't send the session cookie over
//      the WS handshake. The client fetches a ticket (GET /auth/ws-ticket) and
//      passes it here.
//   2. Session cookie (same-origin / dev).
// Returns null on any failure path (callers reject the connection).
import type { IncomingHttpHeaders } from 'http';
import { extractSessionCookie } from '../common/session-cookie';
import { AuthService } from './auth.service';

export async function resolveWsUser(
  headers: IncomingHttpHeaders,
  auth: AuthService,
  url?: string,
): Promise<string | null> {
  if (url) {
    try {
      const queryToken = new URL(url, 'http://localhost').searchParams.get('token');
      if (queryToken) {
        const userId = await auth.findUserBySessionToken(queryToken);
        if (userId) return userId;
      }
    } catch {
      // malformed URL — fall through to the cookie path
    }
  }
  const cookieHeader = Array.isArray(headers.cookie) ? headers.cookie.join('; ') : headers.cookie;
  const token = extractSessionCookie(cookieHeader ?? null);
  if (!token) return null;
  return auth.findUserBySessionToken(token);
}
