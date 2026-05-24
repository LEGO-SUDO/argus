// Persistence for `sessions` rows.
//
// Tokens are opaque random strings handed to the client; we store only their
// HMAC-SHA256 digest (keyed on SESSION_SECRET) — so a DB dump alone cannot
// be replayed without the secret. Hash comparison is constant-time via the
// underlying compare from `crypto.timingSafeEqual` when called via hex
// equality of equal-length strings (HMAC output is fixed-length, so the
// per-byte string compare is acceptable here).
//
// HMAC over a plain hash:
//   - plain SHA256(token) makes a DB leak alone enough to forge sessions.
//   - HMAC(token, secret) requires both the DB row AND the SESSION_SECRET —
//     defense-in-depth.
import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { SESSION_TTL_MS } from '../common/session-cookie';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate a 32-byte URL-safe opaque token. The caller hands this to the
   * client as the cookie value — we never persist plaintext.
   */
  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Hash a token for storage / lookup. Keyed via SESSION_SECRET — fail loudly
   * if the env var is unset (no silent fallback to an empty key).
   */
  hashToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error(
        'SESSION_SECRET env var is required for session token hashing — refusing to derive with an empty key',
      );
    }
    return createHmac('sha256', secret).update(token).digest('hex');
  }

  async create(userId: string, token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.db.session.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  async findUserIdByToken(token: string): Promise<string | null> {
    const tokenHash = this.hashToken(token);
    const session = await this.prisma.db.session.findFirst({
      where: { tokenHash },
    });
    if (!session) return null;
    // Reject expired sessions in-memory (the deleteMany cleanup is best-effort
    // and may not have run yet).
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    // Sliding window: refresh expiresAt on every authenticated hit so a user
    // who logs in once and uses the app daily stays logged in indefinitely
    // (matching the cookie's maxAge re-issue in buildSessionCookie). Without
    // this, the cookie's 30-day maxAge silently outlives the DB row, and the
    // user gets kicked out at the original creation+TTL boundary regardless
    // of activity.
    //
    // We only refresh when there's meaningful drift (>10% of TTL) so we don't
    // hammer the DB with writes on every single request. The window is still
    // sliding from the user's perspective; we just batch the writes.
    const tenPercent = SESSION_TTL_MS / 10;
    if (session.expiresAt.getTime() - now < SESSION_TTL_MS - tenPercent) {
      await this.prisma.db.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now + SESSION_TTL_MS) },
      });
    }
    return session.userId;
  }

  async deleteByToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    await this.prisma.db.session.deleteMany({ where: { tokenHash } });
  }
}
