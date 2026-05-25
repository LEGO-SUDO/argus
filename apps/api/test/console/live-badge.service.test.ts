import { randomUUID } from 'crypto';
import { LiveBadgeService } from '../../src/console/live-badge.service';
import { FakeClock } from '../../src/common/clock';
import type { ApiConfig } from '../../src/common/config';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import * as sentry from '../../src/observability/sentry';

const NOW = new Date('2026-05-25T12:00:00.000Z');
const config = { liveBadgeGreenThresholdMs: 5_000, liveBadgeErrorThresholdMs: 30_000 } as ApiConfig;

function build(): { svc: LiveBadgeService; prisma: InMemoryPrisma } {
  const prisma = createInMemoryPrisma();
  const svc = new LiveBadgeService({ db: prisma } as unknown as PrismaService, new FakeClock(NOW), config);
  return { svc, prisma };
}

function seedHeartbeat(prisma: InMemoryPrisma, secondsAgo: number): void {
  prisma.traceEvents.push({
    id: randomUUID(),
    traceId: randomUUID(),
    spanId: randomUUID(),
    messageId: null,
    userId: null,
    name: 'llm.heartbeat',
    payload: {},
    truncated: false,
    kind: 'heartbeat',
    createdAt: new Date(NOW.getTime() - secondsAgo * 1000),
  });
}

describe('LiveBadgeService.state', () => {
  it('returns live with lagSeconds under the green threshold', async () => {
    const { svc, prisma } = build();
    seedHeartbeat(prisma, 2);
    expect(await svc.state()).toEqual({ state: 'live', lagSeconds: 2 });
  });

  it('returns behind between the thresholds', async () => {
    const { svc, prisma } = build();
    seedHeartbeat(prisma, 10);
    expect(await svc.state()).toEqual({ state: 'behind', lagSeconds: 10 });
  });

  it('returns error past the error threshold', async () => {
    const { svc, prisma } = build();
    seedHeartbeat(prisma, 60);
    const s = await svc.state();
    expect(s.state).toBe('error');
    expect(s.message).toMatch(/ingestion/i);
  });

  it('uses the freshest heartbeat when several exist', async () => {
    const { svc, prisma } = build();
    seedHeartbeat(prisma, 60);
    seedHeartbeat(prisma, 2);
    expect((await svc.state()).state).toBe('live');
  });

  it('returns live on empty heartbeat history', async () => {
    const { svc } = build();
    expect(await svc.state()).toEqual({ state: 'live', lagSeconds: 0 });
  });

  it('returns error (DB unreachable) when the query throws, capturing the error', async () => {
    const spy = jest.spyOn(sentry, 'captureApiError').mockImplementation(() => undefined);
    const prisma = { db: { traceEvent: { findMany: async () => { throw new Error('connection refused'); } } } } as unknown as PrismaService;
    const svc = new LiveBadgeService(prisma, new FakeClock(NOW), config);
    const s = await svc.state();
    expect(s).toEqual({ state: 'error', message: 'DB unreachable' });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ feature: 'live', layer: 'service' }));
    spy.mockRestore();
  });
});
