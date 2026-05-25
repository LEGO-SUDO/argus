import { randomUUID } from 'crypto';
import { JanitorService } from '../../src/janitor/janitor.service';
import { FakeClock } from '../../src/common/clock';
import type { ApiConfig } from '../../src/common/config';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma, InferenceKind } from '../fixtures/prisma-test-client';
import { seedInference } from '../console/seed-inference';
import * as sentry from '../../src/observability/sentry';

const NOW = new Date('2026-05-25T12:00:00.000Z');
const config = { janitorStrandedThresholdMs: 60_000 } as ApiConfig;

function build(): { svc: JanitorService; prisma: InMemoryPrisma; userId: string } {
  const prisma = createInMemoryPrisma();
  const svc = new JanitorService({ db: prisma } as unknown as PrismaService, new FakeClock(NOW), config);
  return { svc, prisma, userId: randomUUID() };
}

function stranded(prisma: InMemoryPrisma, userId: string, kind: InferenceKind, updatedSecondsAgo: number, status: 'streaming' | 'ok' = 'streaming'): string {
  return seedInference(prisma, userId, {
    kind,
    status: status === 'streaming' ? 'streaming' : 'ok',
    startedAt: new Date(NOW.getTime() - 10 * 60_000),
    updatedAt: new Date(NOW.getTime() - updatedSecondsAgo * 1000),
  });
}

describe('JanitorService.sweep', () => {
  it('marks a stranded streaming chat row failed with error_code=api_restart and stamps ended_at', async () => {
    const { svc, prisma, userId } = build();
    const id = stranded(prisma, userId, 'chat', 120);
    const swept = await svc.sweep();
    expect(swept).toBe(1);
    const row = prisma.inferences.find((i) => i.id === id)!;
    expect(row.status).toBe('failed');
    expect(row.errorCode).toBe('api_restart');
    expect(row.endedAt?.getTime()).toBe(NOW.getTime());
  });

  it('leaves a recently-active stream alone (keys on updated_at, not started_at)', async () => {
    const { svc, prisma, userId } = build();
    const id = stranded(prisma, userId, 'chat', 5); // updated 5s ago, threshold 60s
    await svc.sweep();
    expect(prisma.inferences.find((i) => i.id === id)!.status).toBe('streaming');
  });

  it('is idempotent — the second sweep affects zero rows', async () => {
    const { svc, prisma, userId } = build();
    stranded(prisma, userId, 'chat', 120);
    expect(await svc.sweep()).toBe(1);
    expect(await svc.sweep()).toBe(0);
  });

  it('sweeps replay + sample kinds but never classifier + heartbeat', async () => {
    const { svc, prisma, userId } = build();
    stranded(prisma, userId, 'replay', 120);
    stranded(prisma, userId, 'sample', 120);
    const classifierId = stranded(prisma, userId, 'classifier', 120);
    const heartbeatId = stranded(prisma, userId, 'heartbeat', 120);
    const swept = await svc.sweep();
    expect(swept).toBe(2);
    expect(prisma.inferences.find((i) => i.id === classifierId)!.status).toBe('streaming');
    expect(prisma.inferences.find((i) => i.id === heartbeatId)!.status).toBe('streaming');
  });

  it('captures a DB failure and returns 0 so the next interval retries', async () => {
    const spy = jest.spyOn(sentry, 'captureApiError').mockImplementation(() => undefined);
    const prisma = { db: { inference: { updateMany: async () => { throw new Error('db down'); } } } } as unknown as PrismaService;
    const svc = new JanitorService(prisma, new FakeClock(NOW), config);
    expect(await svc.sweep()).toBe(0);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ feature: 'janitor', layer: 'service' }));
    spy.mockRestore();
  });
});
