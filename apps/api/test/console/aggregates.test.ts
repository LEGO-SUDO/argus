import { randomUUID } from 'crypto';
import { Aggregates } from '../../src/console/aggregates';
import { FakeClock } from '../../src/common/clock';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma, InferenceKind } from '../fixtures/prisma-test-client';

const NOW = new Date('2026-05-25T12:00:00.000Z');

interface SeedOpts {
  kind?: InferenceKind;
  provider?: string;
  model?: string;
  status?: 'ok' | 'failed' | 'canceled' | 'streaming';
  promptCost?: number | null;
  completionCost?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  conversationId?: string;
  sampleWorkspaceId?: string | null;
  startedAt?: Date;
}

function seed(prisma: InMemoryPrisma, userId: string, o: SeedOpts = {}): void {
  prisma.inferences.push({
    id: randomUUID(),
    messageId: randomUUID(),
    conversationId: o.conversationId ?? randomUUID(),
    userId,
    provider: o.provider ?? 'openai',
    model: o.model ?? 'gpt-4o',
    status: o.status ?? 'ok',
    kind: o.kind ?? 'chat',
    latencyMs: 100,
    promptTokens: o.promptTokens ?? 10,
    completionTokens: o.completionTokens ?? 20,
    promptCostUsdMicros: o.promptCost === undefined ? 1000 : o.promptCost,
    completionCostUsdMicros: o.completionCost === undefined ? 2000 : o.completionCost,
    startedAt: o.startedAt ?? new Date(NOW.getTime() - 60_000),
    endedAt: null,
    inputPreview: null,
    outputPreview: null,
    traceId: null,
    spanId: null,
    errorCode: null,
    classifierForMessageId: null,
    replayOfInferenceId: null,
    sampleWorkspaceId: o.sampleWorkspaceId ?? null,
    updatedAt: NOW,
  });
}

function build(): { agg: Aggregates; prisma: InMemoryPrisma; userId: string } {
  const prisma = createInMemoryPrisma();
  const agg = new Aggregates({ db: prisma } as unknown as PrismaService, new FakeClock(NOW));
  return { agg, prisma, userId: randomUUID() };
}

describe('Aggregates.costByConversation', () => {
  it('default-groups by conversation over chat rows only, excluding every other kind', async () => {
    const { agg, prisma, userId } = build();
    const conv = randomUUID();
    seed(prisma, userId, { conversationId: conv, promptCost: 1000, completionCost: 2000 });
    seed(prisma, userId, { conversationId: conv, kind: 'replay', promptCost: 5000, completionCost: 5000 });
    seed(prisma, userId, { conversationId: conv, kind: 'sample', sampleWorkspaceId: randomUUID() });
    seed(prisma, userId, { conversationId: conv, kind: 'classifier' });
    seed(prisma, userId, { conversationId: conv, kind: 'heartbeat' });

    const res = await agg.costByConversation({ userId, window: '24h' });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]!.totalCostMicros).toBe(3000); // only the chat row
    expect(res.totalMicroUsd).toBe(3000);
  });

  it('includeReplay adds replay rows; includeMock adds mock rows; toggles compose', async () => {
    const { agg, prisma, userId } = build();
    const conv = randomUUID();
    seed(prisma, userId, { conversationId: conv, promptCost: 1000, completionCost: 0 }); // chat 1000
    seed(prisma, userId, { conversationId: conv, kind: 'replay', promptCost: 500, completionCost: 0 }); // replay 500
    seed(prisma, userId, { conversationId: conv, provider: 'mock', promptCost: 9, completionCost: 0 }); // mock chat 9

    expect((await agg.costByConversation({ userId, window: '24h' })).totalMicroUsd).toBe(1000);
    expect((await agg.costByConversation({ userId, window: '24h', includeReplay: true })).totalMicroUsd).toBe(1500);
    expect(
      (await agg.costByConversation({ userId, window: '24h', includeReplay: true, includeMock: true })).totalMicroUsd,
    ).toBe(1509);
  });

  it('surfaces missing-pricing: pricedTotal + unpricedCount + deduped unpricedModels', async () => {
    const { agg, prisma, userId } = build();
    const conv = randomUUID();
    seed(prisma, userId, { conversationId: conv, model: 'gpt-4o', promptCost: 1000, completionCost: 1000 });
    seed(prisma, userId, { conversationId: conv, model: 'gemini-3-flash-preview', promptCost: null, completionCost: null });
    seed(prisma, userId, { conversationId: conv, model: 'gemini-3-flash-preview', promptCost: null, completionCost: null });

    const res = await agg.costByConversation({ userId, window: '24h' });
    const g = res.groups[0]!;
    expect(g.totalCostMicros).toBe(2000);
    expect(g.unpricedCount).toBe(2);
    expect(g.unpricedModels).toEqual(['gemini-3-flash-preview']);
    expect(res.unpricedModels).toEqual(['gemini-3-flash-preview']);
  });

  it('regroups by provider and by model', async () => {
    const { agg, prisma, userId } = build();
    seed(prisma, userId, { provider: 'openai', model: 'gpt-4o', promptCost: 100, completionCost: 0 });
    seed(prisma, userId, { provider: 'anthropic', model: 'claude-haiku-4-5', promptCost: 300, completionCost: 0 });
    const byProvider = await agg.costGrouped({ userId, window: '24h' }, 'provider');
    expect(byProvider.groups.map((g) => g.key)).toEqual(['anthropic', 'openai']); // total desc
    const byModel = await agg.costGrouped({ userId, window: '24h' }, 'model');
    expect(byModel.groups).toHaveLength(2);
  });
});

describe('Aggregates.throughputForUser + errorRate', () => {
  it('counts chat-only turns + tokens per hour and computes the error rate', async () => {
    const { agg, prisma, userId } = build();
    seed(prisma, userId, { status: 'ok', promptTokens: 10, completionTokens: 10 });
    seed(prisma, userId, { status: 'failed', promptTokens: 10, completionTokens: 10 });
    seed(prisma, userId, { status: 'canceled', promptTokens: 10, completionTokens: 10 });
    seed(prisma, userId, { status: 'ok', promptTokens: 10, completionTokens: 10 });
    seed(prisma, userId, { kind: 'replay', status: 'failed' }); // excluded from throughput

    const t = await agg.throughputForUser({ userId, window: '24h' });
    expect(t.turnsPerHour).toBeCloseTo(4 / 24);
    expect(t.tokensPerHour).toBeCloseTo(80 / 24);
    // 1 failed / 4 chat rows
    expect(t.errorRate).toBeCloseTo(0.25);
  });

  it('errorRate excludes replay/sample/heartbeat from numerator and denominator', async () => {
    const { agg, prisma, userId } = build();
    seed(prisma, userId, { status: 'ok' });
    seed(prisma, userId, { status: 'failed' });
    seed(prisma, userId, { kind: 'replay', status: 'failed' });
    seed(prisma, userId, { kind: 'heartbeat', status: 'failed' });
    expect(await agg.errorRate({ userId, window: '24h' })).toBeCloseTo(0.5);
  });
});

describe('Aggregates.sparkline', () => {
  it('returns chronological per-hour points with empty hours backfilled to zero', async () => {
    const { agg, prisma, userId } = build();
    // Two chat rows 3h and 1h before NOW.
    seed(prisma, userId, { startedAt: new Date(NOW.getTime() - 3 * 3_600_000), promptCost: 100, completionCost: 0 });
    seed(prisma, userId, { startedAt: new Date(NOW.getTime() - 1 * 3_600_000), promptCost: 200, completionCost: 0 });
    const points = await agg.sparkline({ userId, window: '24h' });
    expect(points.length).toBeGreaterThanOrEqual(24);
    // Chronological
    const times = points.map((p) => new Date(p.hourStart).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Total spend across buckets equals the priced sum.
    expect(points.reduce((n, p) => n + p.costMicros, 0)).toBe(300);
  });
});

describe('Aggregates sample-workspace visibility', () => {
  it('shows sample rows only for the active workspace and only when includeSample', async () => {
    const { agg, prisma, userId } = build();
    const activeWs = randomUUID();
    const otherWs = randomUUID();
    seed(prisma, userId, { promptCost: 100, completionCost: 0 }); // chat
    seed(prisma, userId, { kind: 'sample', sampleWorkspaceId: activeWs, promptCost: 50, completionCost: 0 });
    seed(prisma, userId, { kind: 'sample', sampleWorkspaceId: otherWs, promptCost: 999, completionCost: 0 });

    // Default: no sample rows at all.
    expect((await agg.costByConversation({ userId, window: '24h', currentSampleWorkspaceId: activeWs })).totalMicroUsd).toBe(100);
    // includeSample: only the active-workspace sample row joins.
    expect(
      (await agg.costByConversation({ userId, window: '24h', includeSample: true, currentSampleWorkspaceId: activeWs })).totalMicroUsd,
    ).toBe(150);
    // Other-workspace sample never shows even with the toggle.
    expect(
      (await agg.costByConversation({ userId, window: '24h', includeSample: true, currentSampleWorkspaceId: otherWs })).totalMicroUsd,
    ).toBe(100 + 999);
  });

  it('with both replay+sample excluded, neither contributes even if workspace matches', async () => {
    const { agg, prisma, userId } = build();
    const ws = randomUUID();
    seed(prisma, userId, { promptCost: 100, completionCost: 0 });
    seed(prisma, userId, { kind: 'replay', promptCost: 100, completionCost: 0 });
    seed(prisma, userId, { kind: 'sample', sampleWorkspaceId: ws, promptCost: 100, completionCost: 0 });
    const res = await agg.costByConversation({ userId, window: '24h', currentSampleWorkspaceId: ws });
    expect(res.totalMicroUsd).toBe(100);
  });

  it('cross-user isolation: another user\'s rows never contribute', async () => {
    const { agg, prisma, userId } = build();
    seed(prisma, userId, { promptCost: 100, completionCost: 0 });
    seed(prisma, randomUUID(), { promptCost: 9999, completionCost: 0 });
    expect((await agg.costByConversation({ userId, window: '24h' })).totalMicroUsd).toBe(100);
  });

  it('time window filters by startedAt; "all" returns every age', async () => {
    const { agg, prisma, userId } = build();
    seed(prisma, userId, { startedAt: new Date(NOW.getTime() - 60_000), promptCost: 10, completionCost: 0 }); // 1m ago
    seed(prisma, userId, { startedAt: new Date(NOW.getTime() - 3 * 86_400_000), promptCost: 20, completionCost: 0 }); // 3d ago
    expect((await agg.costByConversation({ userId, window: '24h' })).totalMicroUsd).toBe(10);
    expect((await agg.costByConversation({ userId, window: '7d' })).totalMicroUsd).toBe(30);
    expect((await agg.costByConversation({ userId, window: 'all' })).totalMicroUsd).toBe(30);
  });
});
