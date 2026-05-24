// WS handshake cookie → userId resolver.
//
// Task 15: parses raw `cookie` header from the WS upgrade request, extracts
// the session cookie by configured name, and resolves it via AuthService.
// Returns null on any failure path (missing header, no matching cookie,
// unknown token) — callers reject the connection.
import type { IncomingHttpHeaders } from 'http';
import { extractSessionCookie } from '../common/session-cookie';
import { AuthService } from './auth.service';

export async function resolveWsUser(
  headers: IncomingHttpHeaders,
  auth: AuthService,
): Promise<string | null> {
  const cookieHeader = Array.isArray(headers.cookie) ? headers.cookie.join('; ') : headers.cookie;
  const token = extractSessionCookie(cookieHeader ?? null);
  if (!token) return null;
  return auth.findUserBySessionToken(token);
}
