// Task 6 (RED) / Task 7 (GREEN): idempotency-guard duplicate-span dedupe.
//
// Tested against a stub Prisma client to keep this fast — the unit verifies
// the unique-violation translation logic. The full DB integration is exercised
// by projection.service.integration.test.ts.
import { Prisma } from '@argus/db';
import { tryInsertTraceEvent } from '../src/projection/idempotency-guard';
import type { TraceEventInsert } from '@argus/contracts';

function makeInsert(overrides: Partial<TraceEventInsert> = {}): TraceEventInsert {
  return {
    traceId: 'trace-1',
    spanId: 'span-1',
    messageId: '33333333-3333-3333-3333-333333333333',
    userId: '22222222-2222-2222-2222-222222222222',
    name: 'llm.input',
    payload: { hello: 'world' },
    truncated: false,
    ...overrides,
  };
}

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  // Construct without invoking the real Prisma error chain — we just need
  // the .code === 'P2002' shape.
  const err = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`trace_id`,`span_id`)',
    {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['trace_id', 'span_id'] },
    },
  );
  return err;
}

describe('tryInsertTraceEvent', () => {
  it('returns proceed=true when the insert succeeds', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'inserted' });
    const tx = { traceEvent: { create } } as never;
    const verdict = await tryInsertTraceEvent(tx, makeInsert());
    expect(verdict).toEqual({ proceeded: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns proceed=false when Prisma raises P2002 (unique violation)', async () => {
    const create = jest.fn().mockRejectedValue(makeP2002());
    const tx = { traceEvent: { create } } as never;
    const verdict = await tryInsertTraceEvent(tx, makeInsert());
    expect(verdict).toEqual({ proceeded: false, reason: 'duplicate' });
  });

  it('propagates non-P2002 errors', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection refused'));
    const tx = { traceEvent: { create } } as never;
    await expect(tryInsertTraceEvent(tx, makeInsert())).rejects.toThrow('connection refused');
  });

  it('different span_ids both proceed', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: 'a' })
      .mockResolvedValueOnce({ id: 'b' });
    const tx = { traceEvent: { create } } as never;
    const v1 = await tryInsertTraceEvent(tx, makeInsert({ spanId: 'span-A' }));
    const v2 = await tryInsertTraceEvent(tx, makeInsert({ spanId: 'span-B' }));
    expect(v1.proceeded).toBe(true);
    expect(v2.proceeded).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
