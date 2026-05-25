import { randomUUID } from 'crypto';
import { ClearService } from '../../src/console/clear.service';
import { FakeClock } from '../../src/common/clock';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';
import type { OrchestratorHandle } from '../../src/orchestrator/handle';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference } from './seed-inference';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function build(clock = new FakeClock(NOW)): {
  service: ClearService;
  prisma: InMemoryPrisma;
  registry: OrchestratorRegistry;
  userId: string;
  clock: FakeClock;
} {
  const prisma = createInMemoryPrisma();
  const registry = new OrchestratorRegistry();
  const service = new ClearService({ db: prisma } as unknown as PrismaService, clock, registry);
  return { service, prisma, registry, userId: randomUUID(), clock };
}

function handle(kind: OrchestratorHandle['kind'], cancel: () => Promise<void>): OrchestratorHandle {
  return { messageId: randomUUID(), kind, cancel };
}

describe('ClearService.execute', () => {
  it('upserts the fence with a monotonic timestamp', async () => {
    const { service, prisma, userId, clock } = build();
    await service.execute({ userId });
    expect(prisma.userClearFences).toHaveLength(1);
    const first = prisma.userClearFences[0]!.clearAfterTs.getTime();
    clock.advance(1000);
    await service.execute({ userId });
    expect(prisma.userClearFences).toHaveLength(1); // same row
    expect(prisma.userClearFences[0]!.clearAfterTs.getTime()).toBe(first + 1000);
  });

  it('cancels the calling user\'s in-flight runs, leaving other users untouched', async () => {
    const { service, registry, userId } = build();
    const a1 = jest.fn(async () => undefined);
    const a2 = jest.fn(async () => undefined);
    const b1 = jest.fn(async () => undefined);
    registry.register(userId, handle('chat', a1));
    registry.register(userId, handle('replay', a2));
    const otherUser = randomUUID();
    registry.register(otherUser, handle('chat', b1));

    await service.execute({ userId });
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(b1).not.toHaveBeenCalled();
    expect(registry.list(otherUser)).toHaveLength(1);
  });

  it('deletes only the caller\'s rows started before the fence', async () => {
    const { service, prisma, userId } = build();
    const otherUser = randomUUID();
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 1000) }); // before fence → deleted
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() + 1000) }); // after fence → kept
    seedInference(prisma, otherUser, { startedAt: new Date(NOW.getTime() - 1000) }); // other user → kept
    prisma.traceEvents.push({ id: randomUUID(), traceId: 't', spanId: 's', messageId: null, userId, name: 'llm.input', payload: {}, truncated: false, kind: 'chat', createdAt: new Date(NOW.getTime() - 1000) });
    prisma.traceEvents.push({ id: randomUUID(), traceId: 't2', spanId: 's2', messageId: null, userId: otherUser, name: 'llm.input', payload: {}, truncated: false, kind: 'chat', createdAt: new Date(NOW.getTime() - 1000) });

    await service.execute({ userId });

    expect(prisma.inferences.filter((i) => i.userId === userId)).toHaveLength(1); // the after-fence row
    expect(prisma.inferences.filter((i) => i.userId === otherUser)).toHaveLength(1);
    expect(prisma.traceEvents.filter((t) => t.userId === userId)).toHaveLength(0);
    expect(prisma.traceEvents.filter((t) => t.userId === otherUser)).toHaveLength(1);
  });

  it('runs the delete strictly after cancels resolve, sweeping a late terminal write (race property)', async () => {
    const { service, prisma, registry, userId } = build();
    // A streaming row that started before the fence; its handle "finalizes" it
    // during cancel (a late terminal write) — must still be swept.
    const lateId = seedInference(prisma, userId, { status: 'streaming', startedAt: new Date(NOW.getTime() - 5000) });
    registry.register(
      userId,
      handle('chat', async () => {
        const row = prisma.inferences.find((i) => i.id === lateId)!;
        row.status = 'canceled'; // commits AFTER the fence is written, BEFORE the delete pass
      }),
    );

    await service.execute({ userId });
    expect(prisma.inferences.find((i) => i.id === lateId)).toBeUndefined();
    expect(prisma.inferences.filter((i) => i.startedAt.getTime() < NOW.getTime())).toHaveLength(0);
  });

  it('returns a per-kind deletion breakdown', async () => {
    const { service, prisma, userId } = build();
    const before = new Date(NOW.getTime() - 1000);
    seedInference(prisma, userId, { kind: 'chat', startedAt: before });
    seedInference(prisma, userId, { kind: 'chat', startedAt: before });
    seedInference(prisma, userId, { kind: 'replay', startedAt: before });
    seedInference(prisma, userId, { kind: 'sample', startedAt: before, sampleWorkspaceId: randomUUID() });
    const breakdown = await service.execute({ userId });
    expect(breakdown).toEqual({ total: 4, chat: 2, replay: 1, sample: 1 });
  });
});

describe('ClearService.preview', () => {
  it('counts what clearing now would delete, by kind, without writing', async () => {
    const { service, prisma, userId } = build();
    seedInference(prisma, userId, { kind: 'chat', startedAt: new Date(NOW.getTime() - 1000) });
    seedInference(prisma, userId, { kind: 'sample', startedAt: new Date(NOW.getTime() - 1000), sampleWorkspaceId: randomUUID() });
    const preview = await service.preview({ userId });
    expect(preview).toEqual({ total: 2, chat: 1, replay: 0, sample: 1 });
    // No writes.
    expect(prisma.userClearFences).toHaveLength(0);
    expect(prisma.inferences).toHaveLength(2);
  });
});
