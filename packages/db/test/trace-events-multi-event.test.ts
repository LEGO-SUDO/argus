// Task 5a/5b: a single span persists BOTH of its named events.
//
// With the Phase A (trace_id, span_id) unique the second event row was
// rejected — only one survived. Migration 0003 widens the unique to
// (trace_id, span_id, name), so both rows persist on first delivery while a
// redelivered span (identical tuples) still collides on its first event.
//
// This is the db-package local guard for the constraint shape (the workers
// integration suite exercises the same behavior end-to-end).
import { randomUUID } from 'node:crypto';
import {
  bootTestDb,
  teardownTestDb,
  dockerAvailable,
  type TestDb,
} from './helpers/prisma-testcontainer';

const describeIntegration = dockerAvailable() ? describe : describe.skip;

if (!dockerAvailable()) {
  // eslint-disable-next-line no-console
  console.warn('[trace-events-multi-event] SKIPPED: docker unavailable.');
}

describeIntegration('trace_events multi-event-per-span persistence', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await bootTestDb();
  }, 120_000);

  afterAll(async () => {
    if (db) await teardownTestDb(db);
  }, 30_000);

  it('a single span with two distinct event names persists both trace_events rows', async () => {
    const traceId = `trace-${randomUUID()}`;
    const spanId = `span-${randomUUID()}`;

    await db.prisma.traceEvent.create({
      data: { traceId, spanId, name: 'llm.input', payload: { in: true }, truncated: false },
    });
    await db.prisma.traceEvent.create({
      data: { traceId, spanId, name: 'llm.output', payload: { out: true }, truncated: false },
    });

    const rows = await db.prisma.traceEvent.findMany({ where: { traceId, spanId } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(['llm.input', 'llm.output']));
  });

  it('a redelivered span repeats an identical (trace_id, span_id, name) tuple and collides (P2002)', async () => {
    const traceId = `trace-${randomUUID()}`;
    const spanId = `span-${randomUUID()}`;
    await db.prisma.traceEvent.create({
      data: { traceId, spanId, name: 'llm.input', payload: {}, truncated: false },
    });
    await expect(
      db.prisma.traceEvent.create({
        data: { traceId, spanId, name: 'llm.input', payload: {}, truncated: false },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
