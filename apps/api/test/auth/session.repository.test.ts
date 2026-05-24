// SessionRepository — focused on the sliding-window refresh on findUserIdByToken.
//
// Without sliding refresh, the cookie's maxAge re-issue silently outlives the
// DB row: a user created 29 days ago who logs in today gets a fresh 30-day
// cookie but the DB row still expires the next day, kicking them out at
// 30 days regardless of activity. The repo refreshes expiresAt on every hit
// once the remaining TTL drifts > 10% so daily-active users stay logged in
// indefinitely.
import { SessionRepository } from '../../src/auth/session.repository';
import { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { SESSION_TTL_MS } from '../../src/common/session-cookie';
import { randomUUID } from 'crypto';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

function build(prisma: InMemoryPrisma): SessionRepository {
  return new SessionRepository(new PrismaService(prisma as never));
}

describe('SessionRepository.findUserIdByToken — sliding window', () => {
  it('refreshes expiresAt on hit when the row is well past its initial TTL minus 10%', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const userId = randomUUID();
    const token = repo.generateToken();
    // Plant a session whose expiresAt is one day from now (24h remaining,
    // 29 days of TTL elapsed against a 30-day budget). Definitely past the
    // 10% drift threshold.
    const expiresSoon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    prisma.sessions.push({
      id: randomUUID(),
      userId,
      tokenHash: repo.hashToken(token),
      expiresAt: expiresSoon,
      createdAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
    });

    const before = prisma.sessions[0]!.expiresAt.getTime();
    const result = await repo.findUserIdByToken(token);
    const after = prisma.sessions[0]!.expiresAt.getTime();

    expect(result).toBe(userId);
    // The new expiry MUST be a full TTL from now, not the original 24h.
    expect(after).toBeGreaterThan(before);
    expect(after - Date.now()).toBeGreaterThan(SESSION_TTL_MS * 0.95);
  });

  it('does NOT refresh expiresAt on hit when the row was issued recently (no DB write hammer)', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const userId = randomUUID();
    const token = repo.generateToken();
    // A row issued seconds ago — well inside the 10% drift threshold.
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    prisma.sessions.push({
      id: randomUUID(),
      userId,
      tokenHash: repo.hashToken(token),
      expiresAt,
      createdAt: new Date(),
    });

    const before = prisma.sessions[0]!.expiresAt.getTime();
    const result = await repo.findUserIdByToken(token);
    const after = prisma.sessions[0]!.expiresAt.getTime();

    expect(result).toBe(userId);
    // No write — the row's expiresAt is unchanged.
    expect(after).toBe(before);
  });

  it('returns null and does not refresh expired rows', async () => {
    const prisma = createInMemoryPrisma();
    const repo = build(prisma);
    const userId = randomUUID();
    const token = repo.generateToken();
    const originalExpiresAt = new Date(Date.now() - 1000);
    prisma.sessions.push({
      id: randomUUID(),
      userId,
      tokenHash: repo.hashToken(token),
      expiresAt: originalExpiresAt,
      createdAt: new Date(Date.now() - SESSION_TTL_MS - 2000),
    });

    const result = await repo.findUserIdByToken(token);
    expect(result).toBeNull();
    // Confirm the row was NOT silently revived.
    expect(prisma.sessions[0]!.expiresAt.getTime()).toBe(originalExpiresAt.getTime());
  });
});
