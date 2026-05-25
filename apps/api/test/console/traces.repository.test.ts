import { randomUUID } from 'crypto';
import { TracesRepository } from '../../src/console/traces.repository';
import { FakeClock } from '../../src/common/clock';
import type { PrismaService } from '../../src/common/prisma.service';
import { createInMemoryPrisma, InMemoryPrisma } from '../fixtures/prisma-test-client';
import { seedInference, seedConversation } from './seed-inference';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function build(): { repo: TracesRepository; prisma: InMemoryPrisma; userId: string } {
  const prisma = createInMemoryPrisma();
  const repo = new TracesRepository({ db: prisma } as unknown as PrismaService, new FakeClock(NOW));
  return { repo, prisma, userId: randomUUID() };
}

describe('TracesRepository.list', () => {
  it('AND-combines provider + status filters (arrays)', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { provider: 'openai', status: 'ok', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'openai', status: 'failed', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'anthropic', status: 'ok', startedAt: NOW });
    const { rows } = await repo.list({ userId, window: '24h', provider: ['openai'], status: ['ok'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.provider).toBe('openai');
    expect(rows[0]!.status).toBe('ok');
  });

  it('OR-combines multiple values within a filter (IN), ANDed across dimensions', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { provider: 'openai', status: 'ok', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'anthropic', status: 'ok', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'gemini', status: 'ok', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'openai', status: 'failed', startedAt: NOW });
    // provider IN (openai, anthropic) AND status IN (ok)
    const { rows } = await repo.list({ userId, window: '24h', provider: ['openai', 'anthropic'], status: ['ok'] });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.provider))).toEqual(new Set(['openai', 'anthropic']));
  });

  it('narrows further by model and conversationId (arrays)', async () => {
    const { repo, prisma, userId } = build();
    const conv = randomUUID();
    seedInference(prisma, userId, { provider: 'openai', model: 'gpt-4o', conversationId: conv, startedAt: NOW });
    seedInference(prisma, userId, { provider: 'openai', model: 'gpt-3.5-turbo', conversationId: conv, startedAt: NOW });
    seedInference(prisma, userId, { provider: 'openai', model: 'gpt-4o', conversationId: randomUUID(), startedAt: NOW });
    const r1 = await repo.list({ userId, window: '24h', provider: ['openai'], model: ['gpt-4o'] });
    expect(r1.rows).toHaveLength(2);
    const r2 = await repo.list({ userId, window: '24h', provider: ['openai'], model: ['gpt-4o'], conversationId: [conv] });
    expect(r2.rows).toHaveLength(1);
  });

  it('an empty filter array applies no constraint on that dimension', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { provider: 'openai', startedAt: NOW });
    seedInference(prisma, userId, { provider: 'anthropic', startedAt: NOW });
    const { rows } = await repo.list({ userId, window: '24h', provider: [] });
    expect(rows).toHaveLength(2);
  });

  it('free-text search matches input/output/title/errorCode case-insensitively', async () => {
    const { repo, prisma, userId } = build();
    const convA = randomUUID();
    seedConversation(prisma, userId, convA, 'Billing questions');
    seedInference(prisma, userId, { conversationId: convA, inputPreview: 'hello world', startedAt: NOW });
    seedInference(prisma, userId, { outputPreview: 'a WIDGET answer', startedAt: NOW });
    seedInference(prisma, userId, { errorCode: 'rate_limited', startedAt: NOW });
    seedInference(prisma, userId, { inputPreview: 'nothing relevant', startedAt: NOW });

    expect((await repo.list({ userId, window: '24h', search: 'widget' })).rows).toHaveLength(1);
    expect((await repo.list({ userId, window: '24h', search: 'BILLING' })).rows).toHaveLength(1);
    expect((await repo.list({ userId, window: '24h', search: 'rate_limited' })).rows).toHaveLength(1);
    expect((await repo.list({ userId, window: '24h', search: 'zzz-none' })).rows).toHaveLength(0);
  });

  it('excludes kind=heartbeat by default regardless of other filters', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { kind: 'chat', startedAt: NOW });
    seedInference(prisma, userId, { kind: 'heartbeat', startedAt: NOW });
    const { rows } = await repo.list({ userId, window: '24h' });
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.kind !== 'heartbeat')).toBe(true);
  });

  it('applies the time-window predicate; "all" returns every age', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 60_000) });
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 3 * 86_400_000) });
    seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - 30 * 86_400_000) });
    expect((await repo.list({ userId, window: '24h' })).rows).toHaveLength(1);
    expect((await repo.list({ userId, window: '7d' })).rows).toHaveLength(2);
    expect((await repo.list({ userId, window: 'all' })).rows).toHaveLength(3);
  });

  it('cursor-paginates newest-first with no overlap and a null terminal cursor', async () => {
    const { repo, prisma, userId } = build();
    for (let i = 0; i < 5; i++) {
      seedInference(prisma, userId, { startedAt: new Date(NOW.getTime() - i * 1000) });
    }
    const page1 = await repo.list({ userId, window: '24h', limit: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.list({ userId, window: '24h', limit: 2, cursor: page1.nextCursor! });
    expect(page2.rows).toHaveLength(2);
    const ids = new Set([...page1.rows, ...page2.rows].map((r) => r.id));
    expect(ids.size).toBe(4); // no overlap
    const page3 = await repo.list({ userId, window: '24h', limit: 2, cursor: page2.nextCursor! });
    expect(page3.rows).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
  });

  it('never returns another user\'s rows even when all other filters match', async () => {
    const { repo, prisma, userId } = build();
    seedInference(prisma, userId, { provider: 'openai', status: 'ok', startedAt: NOW });
    seedInference(prisma, randomUUID(), { provider: 'openai', status: 'ok', startedAt: NOW });
    const { rows } = await repo.list({ userId, window: '24h', provider: ['openai'], status: ['ok'] });
    expect(rows).toHaveLength(1);
  });

  it('populates traceId from the inference trace events, falling back to the inference trace_id', async () => {
    const { repo, prisma, userId } = build();
    // Row A: a trace event carries the canonical trace id.
    const msgA = randomUUID();
    seedInference(prisma, userId, { messageId: msgA, startedAt: NOW });
    prisma.traceEvents.push({
      id: randomUUID(),
      traceId: 'trace-from-event',
      spanId: 's1',
      messageId: msgA,
      userId,
      name: 'llm.output',
      payload: {},
      truncated: false,
      kind: 'chat',
      createdAt: NOW,
    });
    // Row B: no trace event, but the inference row itself carries a trace id.
    seedInference(prisma, userId, { messageId: randomUUID(), traceId: 'trace-on-inference', startedAt: new Date(NOW.getTime() - 1000) });

    const { rows } = await repo.list({ userId, window: '24h' });
    const byMsgA = rows.find((r) => r.id)!; // newest first → row A
    expect(byMsgA.traceId).toBe('trace-from-event');
    const fallbackRow = rows.find((r) => r.traceId === 'trace-on-inference');
    expect(fallbackRow).toBeDefined();
    // Every row carries a string traceId (never undefined).
    expect(rows.every((r) => typeof r.traceId === 'string')).toBe(true);
  });
});
