import { randomUUID } from 'crypto';
import { ReplayRepository } from '../../src/console/replay.repository';
import { FakeClock } from '../../src/common/clock';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference, seedConversation } from './seed-inference';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function build(): { repo: ReplayRepository; prisma: InMemoryPrisma; userId: string } {
  const prisma = createInMemoryPrisma();
  const repo = new ReplayRepository({ db: prisma } as unknown as PrismaService, new FakeClock(NOW));
  return { repo, prisma, userId: randomUUID() };
}

describe('ReplayRepository.candidates', () => {
  it('lists the user\'s terminal chat rows in window; excludes streaming + other users', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { status: 'ok', startedAt: NOW });
    seedInference(prisma, userId, { status: 'failed', startedAt: NOW });
    seedInference(prisma, userId, { status: 'canceled', startedAt: NOW });
    seedInference(prisma, userId, { status: 'streaming', startedAt: NOW }); // excluded
    seedInference(prisma, userId, { kind: 'replay', status: 'ok', startedAt: NOW }); // not a chat candidate
    seedInference(prisma, randomUUID(), { status: 'ok', startedAt: NOW }); // other user

    const { candidates } = await repo.candidates({ userId, window: '24h' });
    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => c.status !== 'streaming')).toBe(true);
    const canceled = candidates.find((c) => c.status === 'canceled');
    expect(canceled!.eligibility).toBe('eligible_with_warning');
    expect(candidates.find((c) => c.status === 'ok')!.eligibility).toBe('eligible');
  });

  it('respects the time window', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 60_000) });
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 3 * 86_400_000) });
    expect((await repo.candidates({ userId, window: '24h' })).candidates).toHaveLength(1);
    expect((await repo.candidates({ userId, window: '7d' })).candidates).toHaveLength(2);
  });
});

describe('ReplayRepository.detail', () => {
  it('returns full metadata for a successful source', async () => {
    const { repo, prisma, userId } = build();
    const conv = randomUUID();
    seedConversation(prisma, userId, conv, 'Conv title');
    const id = seedInference(prisma, userId, {
      conversationId: conv,
      status: 'ok',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      promptCost: 100,
      completionCost: 200,
      inputPreview: 'in',
      outputPreview: 'out',
      startedAt: NOW,
    });
    const d = (await repo.detail({ userId, id }))!;
    expect(d.provider).toBe('anthropic');
    expect(d.model).toBe('claude-haiku-4-5');
    expect(d.totalCostMicros).toBe(300);
    expect(d.inputPreview).toBe('in');
    expect(d.outputPreview).toBe('out');
    expect(d.conversationTitle).toBe('Conv title');
    expect(d.errorCode).toBeNull();
    expect(d.eligibility).toBe('eligible');
  });

  it('carries error_code on a failed source; null on ok', async () => {
    const { repo, prisma, userId } = build();
    const failed = seedInference(prisma, userId, { status: 'failed', errorCode: 'rate_limited', startedAt: NOW });
    const ok = seedInference(prisma, userId, { status: 'ok', startedAt: NOW });
    expect((await repo.detail({ userId, id: failed }))!.errorCode).toBe('rate_limited');
    expect((await repo.detail({ userId, id: ok }))!.errorCode).toBeNull();
  });

  it('returns null for another user\'s inference (controller → 404)', async () => {
    const { repo, prisma, userId } = build();
    const otherId = seedInference(prisma, randomUUID(), { status: 'ok', startedAt: NOW });
    expect(await repo.detail({ userId, id: otherId })).toBeNull();
  });
});
