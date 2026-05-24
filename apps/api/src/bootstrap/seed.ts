// Idempotent demo-user seed.
//
// Task 17: run once on every boot — upsert keyed on email so the seeded row
// is left untouched on the second boot. Defaults:
//   DEMO_EMAIL     = demo@argus.dev
//   DEMO_PASSWORD  = let-me-in-9
//
// The password is hashed with argon2id every boot, but only the `create`
// branch persists the new hash — the `update` branch is a no-op data block,
// so the existing user's password (whatever it is) survives.
import type { PrismaClient } from '@argus/db';
import { hashPassword } from '../auth/password';

export const DEFAULT_DEMO_EMAIL = 'demo@argus.dev';
export const DEFAULT_DEMO_PASSWORD = 'let-me-in-9';

export interface SeedResult {
  email: string;
  created: boolean;
}

export async function seedDemoUser(prisma: PrismaClient): Promise<SeedResult> {
  const email = process.env.DEMO_EMAIL ?? DEFAULT_DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { email, created: false };
  }
  const passwordHash = await hashPassword(password);
  // upsert vs create-with-catch: upsert is one round-trip and the `update`
  // branch covers the race-condition window between findUnique above and the
  // insert below.
  await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash },
    update: {}, // intentionally empty — never modify an existing row
  });
  return { email, created: true };
}
