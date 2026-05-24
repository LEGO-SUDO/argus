// Tasks 5/7/9 (RED) / 6/8/10 (GREEN) — AuthService.
import { AuthService } from '../../src/auth/auth.service';
import { SessionRepository } from '../../src/auth/session.repository';
import { DuplicateEmailError, InvalidCredentialsError } from '../../src/auth/errors';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { PrismaService } from '../../src/common/prisma.service';
import { PRISMA_CLIENT_TOKEN } from '../../src/common/prisma.service';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function buildService(prisma: InMemoryPrisma): AuthService {
  // Cast — the in-memory client implements the subset of PrismaClient we use.
  const prismaService = new PrismaService(prisma as never);
  void PRISMA_CLIENT_TOKEN; // imported for parity
  const sessions = new SessionRepository(prismaService);
  return new AuthService(prismaService, sessions);
}

describe('AuthService', () => {
  describe('signup', () => {
    it('creates a user + session and returns { userId, sessionToken }', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      const result = await svc.signup('alice@example.com', 'super-secret-pw');
      expect(result.userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.sessionToken.length).toBeGreaterThan(0);
      expect(prisma.users.length).toBe(1);
      expect(prisma.sessions.length).toBe(1);
    });

    it('rejects duplicate email with DuplicateEmailError', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      await svc.signup('alice@example.com', 'super-secret-pw');
      await expect(svc.signup('alice@example.com', 'another-pw')).rejects.toBeInstanceOf(
        DuplicateEmailError,
      );
    });
  });

  describe('login', () => {
    it('returns { userId, sessionToken } on correct credentials', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      const signup = await svc.signup('alice@example.com', 'super-secret-pw');
      const login = await svc.login('alice@example.com', 'super-secret-pw');
      expect(login.userId).toBe(signup.userId);
      expect(login.sessionToken).not.toBe(signup.sessionToken);
    });

    it('rejects wrong password with InvalidCredentialsError', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      await svc.signup('alice@example.com', 'super-secret-pw');
      await expect(svc.login('alice@example.com', 'wrong')).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    });

    it('rejects unknown email with InvalidCredentialsError (no enumeration)', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      await expect(svc.login('nobody@example.com', 'anything')).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    });
  });

  describe('logout + findUserBySessionToken', () => {
    it('after logout, the session token resolves to null', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      const { sessionToken } = await svc.signup('alice@example.com', 'super-secret-pw');
      const userBefore = await svc.findUserBySessionToken(sessionToken);
      expect(userBefore).not.toBeNull();
      await svc.logout(sessionToken);
      const userAfter = await svc.findUserBySessionToken(sessionToken);
      expect(userAfter).toBeNull();
    });

    it('logout is a no-op on unknown token', async () => {
      const prisma = createInMemoryPrisma();
      const svc = buildService(prisma);
      await expect(svc.logout('not-a-real-token')).resolves.toBeUndefined();
    });
  });
});
