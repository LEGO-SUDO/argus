// Clear-fence lookup helper (HLD D8).
//
// A user can "Clear" their console history; the api writes a `user_clear_fences`
// row carrying `clear_after_ts`. The projection consumer reads it and DROPS any
// incoming span whose `startedAt` predates the fence — those turns were
// explicitly cleared and must leave no record (the drop fires BEFORE the
// trace_events audit insert; see projection.service Hand-Off Risk note).
//
// Pure async lookup: one PK `findUnique` on user_id (the fence table is keyed on
// user_id, so this is a sub-ms single-row fetch — no caching needed at Phase B
// volumes; a per-batch cache is the documented next-scale optimization).

// Narrow reader shape so callers can pass either the full PrismaClient or a tx.
export interface ClearFenceReader {
  userClearFence: {
    findUnique(args: {
      where: { userId: string };
    }): Promise<{ clearAfterTs: Date } | null>;
  };
}

export type ClearFenceVerdict =
  | { verdict: 'no-fence' }
  | { verdict: 'proceed' }
  | { verdict: 'drop'; fenceTs: Date };

export async function evaluateClearFence(
  reader: ClearFenceReader,
  userId: string,
  spanStartedAt: Date,
): Promise<ClearFenceVerdict> {
  const fence = await reader.userClearFence.findUnique({ where: { userId } });
  if (!fence) return { verdict: 'no-fence' };
  // Fence is strictly ahead of the span -> the span predates the clear -> drop.
  if (fence.clearAfterTs.getTime() > spanStartedAt.getTime()) {
    return { verdict: 'drop', fenceTs: fence.clearAfterTs };
  }
  // Span is at or after the fence -> keep it.
  return { verdict: 'proceed' };
}
