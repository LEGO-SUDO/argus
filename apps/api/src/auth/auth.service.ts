// AuthService — orchestrates signup, login, logout, and session lookup.
//
// Tasks 6/8/10:
//   - signup: hash + insert; rethrow Prisma unique violation as
//     DuplicateEmailError.
//   - login: lookup by email; on missing user run dummy verify for timing
//     equalization (see LLD Open Question). On success mint opaque token,
//     persist HMAC hash, return { userId, sessionToken }.
//   - logout: delete the session row keyed on the token's hash; idempotent
//     no-op on miss.
//   - findUserBySessionToken: hash the token, look up the session, honor
//     expires_at.
import { Injectable } from '@nestjs/common';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password';
import { SessionRepository } from './session.repository';
import { DuplicateEmailError, InvalidCredentialsError } from './errors';
import { PrismaService } from '../common/prisma.service';

export interface SignupResult {
  userId: string;
  sessionToken: string;
}

export interface LoginResult {
  userId: string;
  sessionToken: string;
}

interface PrismaKnownError {
  code?: string;
  meta?: { target?: string[] | string };
}

/**
 * Recognize a Prisma unique-constraint violation on the user.email column
 * specifically. We narrow on the meta.target so a future unique constraint
 * on a different column (e.g., a slug) does not get mis-mapped to
 * DuplicateEmailError. Treats either string[] or string `target` shapes
 * (Prisma 4+ uses string[]; older versions used string).
 */
function isEmailUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as PrismaKnownError;
  if (e.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('email');
  if (typeof target === 'string') return target.includes('email');
  return false;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionRepository,
  ) {}

  async signup(email: string, password: string): Promise<SignupResult> {
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.prisma.db.user.create({
        data: { email, passwordHash },
      });
      const sessionToken = this.sessions.generateToken();
      await this.sessions.create(user.id, sessionToken);
      return { userId: user.id, sessionToken };
    } catch (err) {
      if (isEmailUniqueViolation(err)) {
        throw new DuplicateEmailError(email);
      }
      throw err;
    }
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.db.user.findUnique({ where: { email } });
    if (!user) {
      // Timing equalization: run a verify against a constant dummy hash so the
      // unknown-email path takes the same CPU as a wrong-password path. The
      // result is ignored — we always throw.
      await verifyPassword(DUMMY_HASH, password);
      throw new InvalidCredentialsError();
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new InvalidCredentialsError();
    }
    const sessionToken = this.sessions.generateToken();
    await this.sessions.create(user.id, sessionToken);
    return { userId: user.id, sessionToken };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.sessions.deleteByToken(sessionToken);
  }

  async findUserBySessionToken(sessionToken: string): Promise<string | null> {
    return this.sessions.findUserIdByToken(sessionToken);
  }

  /**
   * Look up a user by primary key. Returns null when no row exists — the
   * caller decides how to react (the /auth/session controller treats this as
   * a stale-session signal and clears the cookie).
   */
  async getUserById(userId: string): Promise<{ id: string; email: string } | null> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return { id: user.id, email: user.email };
  }
}
