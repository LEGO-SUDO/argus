// ProviderHealthService — derives "unavailable" model keys from the recent
// inference log. A (provider, model) at/above ERROR_THRESHOLD failures within
// HEALTH_WINDOW_MS reads back as unavailable; everything else stays usable.
//
// We stub PrismaService's `db.inference.groupBy` directly (the api-test
// convention — no @nestjs/testing) and assert both the windowed WHERE clause
// and the threshold logic.
import {
  ProviderHealthService,
  ERROR_THRESHOLD,
  HEALTH_WINDOW_MS,
  providerModelKey,
} from '../../src/providers/provider-health.service';
import type { PrismaService } from '../../src/common/prisma.service';

type GroupRow = {
  provider: string;
  model: string;
  _count: { _all: number };
};

function makeService(rows: GroupRow[]) {
  const calls: Array<Record<string, unknown>> = [];
  const prisma = {
    db: {
      inference: {
        groupBy: async (args: Record<string, unknown>) => {
          calls.push(args);
          return rows;
        },
      },
    },
  } as unknown as PrismaService;
  return { svc: new ProviderHealthService(prisma), calls };
}

const NOW = new Date('2026-05-25T12:00:00.000Z');

describe('ProviderHealthService.unavailableModelKeys', () => {
  it('flags a (provider, model) at the error threshold', async () => {
    const { svc } = makeService([
      { provider: 'gemini', model: 'gemini-3-flash-preview', _count: { _all: ERROR_THRESHOLD } },
    ]);
    const out = await svc.unavailableModelKeys('user-1', NOW);
    expect(out.has(providerModelKey('gemini', 'gemini-3-flash-preview'))).toBe(true);
    expect(out.size).toBe(1);
  });

  it('does NOT flag a pair below the threshold', async () => {
    const { svc } = makeService([
      { provider: 'openai', model: 'gpt-4o-mini', _count: { _all: ERROR_THRESHOLD - 1 } },
    ]);
    const out = await svc.unavailableModelKeys('user-1', NOW);
    expect(out.size).toBe(0);
  });

  it('queries failed inferences for this user within the health window', async () => {
    const { svc, calls } = makeService([]);
    await svc.unavailableModelKeys('user-42', NOW);
    expect(calls).toHaveLength(1);
    const where = calls[0]!.where as {
      userId: string;
      status: string;
      startedAt: { gte: Date };
    };
    expect(where.userId).toBe('user-42');
    expect(where.status).toBe('failed');
    expect(where.startedAt.gte.getTime()).toBe(NOW.getTime() - HEALTH_WINDOW_MS);
    expect(calls[0]!.by).toEqual(['provider', 'model']);
  });

  it('returns an empty set when there are no recent failures', async () => {
    const { svc } = makeService([]);
    const out = await svc.unavailableModelKeys('user-1', NOW);
    expect(out.size).toBe(0);
  });
});
