// Task 27/28: clear-fence helper verdicts.
//
// Uses the Phase A testcontainer helper (real Postgres) so the helper is
// exercised against the actual user_clear_fences shape from migration 0003.
import { randomUUID } from 'node:crypto';
import { evaluateClearFence } from '../src/projection/clear-fence';
import {
  bootIntegrationEnv,
  dockerAvailable,
  tearDownIntegrationEnv,
  type IntegrationEnv,
} from './helpers/integration-env';

const describeIntegration = dockerAvailable() ? describe : describe.skip;

if (!dockerAvailable()) {
  // eslint-disable-next-line no-console
  console.warn('[clear-fence] SKIPPED: docker unavailable.');
}

describeIntegration('evaluateClearFence', () => {
  let env: IntegrationEnv;

  beforeAll(async () => {
    env = await bootIntegrationEnv();
  }, 120_000);

  afterAll(async () => {
    if (env) await tearDownIntegrationEnv(env);
  }, 30_000);

  async function seedUser(): Promise<string> {
    const id = randomUUID();
    await env.prisma.user.create({
      data: { id, email: `u-${id}@test.local`, passwordHash: 'x' },
    });
    return id;
  }

  it('returns no-fence when the user has no fence row (proceed)', async () => {
    const userId = await seedUser();
    const verdict = await evaluateClearFence(env.prisma, userId, new Date());
    expect(verdict.verdict).toBe('no-fence');
  });

  it('returns drop when the fence is ahead of the span startedAt', async () => {
    const userId = await seedUser();
    const spanStartedAt = new Date();
    await env.prisma.userClearFence.create({
      data: { userId, clearAfterTs: new Date(spanStartedAt.getTime() + 3_600_000) },
    });
    const verdict = await evaluateClearFence(env.prisma, userId, spanStartedAt);
    expect(verdict.verdict).toBe('drop');
  });

  it('returns proceed when the span startedAt is at or after the fence', async () => {
    const userId = await seedUser();
    const spanStartedAt = new Date();
    await env.prisma.userClearFence.create({
      data: { userId, clearAfterTs: new Date(spanStartedAt.getTime() - 3_600_000) },
    });
    const verdict = await evaluateClearFence(env.prisma, userId, spanStartedAt);
    expect(verdict.verdict).toBe('proceed');
  });
});
