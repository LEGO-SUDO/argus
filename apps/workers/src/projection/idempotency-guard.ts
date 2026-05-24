// Idempotency guard.
//
// Strategy: attempt the `trace_events` INSERT and translate Postgres unique
// violation (Prisma P2002) into a "skip" verdict. Any other error propagates.
//
// We DON'T pre-check with a SELECT — that is a TOCTOU race under duplicate
// Collector delivery. Let the unique index be the source of truth.
import { Prisma } from '@argus/db';
import type { TraceEventInsert } from '@argus/contracts';

// Narrow shape we need from a Prisma TX so callers can hand us either the
// full client or a $transaction tx.
export interface TraceEventTx {
  traceEvent: {
    create(args: {
      data: {
        traceId: string;
        spanId: string;
        messageId?: string | null;
        userId?: string | null;
        name: string;
        payload: Prisma.InputJsonValue;
        truncated: boolean;
      };
    }): Promise<unknown>;
  };
}

export type InsertVerdict =
  | { proceeded: true }
  | { proceeded: false; reason: 'duplicate' };

export async function tryInsertTraceEvent(
  tx: TraceEventTx,
  insert: TraceEventInsert,
): Promise<InsertVerdict> {
  try {
    await tx.traceEvent.create({
      data: {
        traceId: insert.traceId,
        spanId: insert.spanId,
        messageId: insert.messageId ?? null,
        userId: insert.userId ?? null,
        name: insert.name,
        payload: (insert.payload ?? null) as Prisma.InputJsonValue,
        truncated: insert.truncated,
      },
    });
    return { proceeded: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { proceeded: false, reason: 'duplicate' };
    }
    // Re-throw — caller decides Sentry capture + DLQ.
    throw err;
  }
}
