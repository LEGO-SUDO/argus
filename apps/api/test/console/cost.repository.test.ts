import { randomUUID } from 'crypto';
import { CostRepository } from '../../src/console/cost.repository';
import { Aggregates } from '../../src/console/aggregates';
import { FakeClock } from '../../src/common/clock';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference, seedConversation } from './seed-inference';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function build(): { repo: CostRepository; prisma: InMemoryPrisma; userId: string } {
  const prisma = createInMemoryPrisma();
  const ps = { db: prisma } as unknown as PrismaService;
  const repo = new CostRepository(ps, new Aggregates(ps, new FakeClock(NOW)));
  return { repo, prisma, userId: randomUUID() };
}

describe('CostRepository.groupBy', () => {
  it('groups by conversation with the title label, ordered by total desc', async () => {
    const { repo, prisma, userId } = build();
    const c1 = randomUUID();
    const c2 = randomUUID();
    seedConversation(prisma, userId, c1, 'Cheap chat');
    seedConversation(prisma, userId, c2, 'Pricey chat');
    seedInference(prisma, userId, { conversationId: c1, promptCost: 100, completionCost: 0, startedAt: NOW });
    seedInference(prisma, userId, { conversationId: c2, promptCost: 500, completionCost: 0, startedAt: NOW });

    const res = await repo.groupBy({ userId, window: '24h', groupBy: 'conversation' });
    expect(res.groups.map((g) => g.label)).toEqual(['Pricey chat', 'Cheap chat']);
    expect(res.groups[0]!.totalCostMicros).toBe(500);
    expect(res.totalMicroUsd).toBe(600);
  });

  it('regroups by provider and by model', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { provider: 'openai', model: 'gpt-4o', promptCost: 100, completionCost: 0, startedAt: NOW });
    seedInference(prisma, userId, { provider: 'anthropic', model: 'claude-haiku-4-5', promptCost: 300, completionCost: 0, startedAt: NOW });
    const byProvider = await repo.groupBy({ userId, window: '24h', groupBy: 'provider' });
    expect(byProvider.groups.map((g) => g.key)).toEqual(['anthropic', 'openai']);
    expect(byProvider.groups[0]!.label).toBe('anthropic');
    const byModel = await repo.groupBy({ userId, window: '24h', groupBy: 'model' });
    expect(byModel.groups.map((g) => g.key).sort()).toEqual(['claude-haiku-4-5', 'gpt-4o']);
  });

  it('default-excludes mock + replay; include toggles add them back', async () => {
    const { repo, prisma, userId } = build();
    const conv = randomUUID();
    seedInference(prisma, userId, { conversationId: conv, promptCost: 100, completionCost: 0, startedAt: NOW });
    seedInference(prisma, userId, { conversationId: conv, kind: 'replay', promptCost: 50, completionCost: 0, startedAt: NOW });
    seedInference(prisma, userId, { conversationId: conv, provider: 'mock', promptCost: 7, completionCost: 0, startedAt: NOW });

    expect((await repo.groupBy({ userId, window: '24h', groupBy: 'conversation' })).totalMicroUsd).toBe(100);
    expect(
      (await repo.groupBy({ userId, window: '24h', groupBy: 'conversation', includeReplay: true, includeMock: true })).totalMicroUsd,
    ).toBe(157);
  });
});
