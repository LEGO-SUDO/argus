// Task 16 (RED) / 17 (GREEN) — idempotent demo-user seed.
import { seedDemoUser } from '../../src/bootstrap/seed';
import { createInMemoryPrisma } from '../fixtures/prisma-test-client';
import type { PrismaClient } from '@argus/db';

describe('seedDemoUser', () => {
  it('creates the demo user on first call and is a no-op on the second call', async () => {
    const prisma = createInMemoryPrisma();
    process.env.DEMO_EMAIL = 'demo-test@argus.dev';
    process.env.DEMO_PASSWORD = 'demo-pass';

    const first = await seedDemoUser(prisma as unknown as PrismaClient);
    expect(first.created).toBe(true);
    expect(first.email).toBe('demo-test@argus.dev');
    expect(prisma.users.length).toBe(1);
    const firstRow = prisma.users[0]!;

    const second = await seedDemoUser(prisma as unknown as PrismaClient);
    expect(second.created).toBe(false);
    expect(prisma.users.length).toBe(1);

    const secondRow = prisma.users[0]!;
    expect(secondRow.id).toBe(firstRow.id);
    expect(secondRow.passwordHash).toBe(firstRow.passwordHash);
  });

  it('uses defaults when env vars are unset', async () => {
    const prisma = createInMemoryPrisma();
    delete process.env.DEMO_EMAIL;
    delete process.env.DEMO_PASSWORD;
    const result = await seedDemoUser(prisma as unknown as PrismaClient);
    expect(result.email).toBe('demo@argus.dev');
  });
});
