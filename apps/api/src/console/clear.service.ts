// ClearService — the Clear-history orchestrator.
//
// Strict ordering (HLD D8) so a stream that finalizes during the clear cannot
// leave a survivor:
//   1. txn#1: upsert the user_clear_fences row (clear_after_ts = now), commit
//      so the projection consumer sees the fence immediately.
//   2. registry.cancelAll(userId) OUTSIDE any txn — wait for every in-flight
//      run's terminal write to land (orchestrator commits are independent
//      connections).
//   3. txn#2: count the per-kind breakdown, then deleteMany inferences +
//      trace_events under `< fence`, atomically against each other.
//   4. return the breakdown.
import { Injectable } from '@nestjs/common';
import type { ClearBreakdown } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { OrchestratorRegistry } from '../orchestrator/registry';

interface InfRow {
  kind: string;
}

function breakdownOf(rows: InfRow[]): ClearBreakdown {
  const chat = rows.filter((r) => r.kind === 'chat').length;
  const replay = rows.filter((r) => r.kind === 'replay').length;
  const sample = rows.filter((r) => r.kind === 'sample').length;
  return { total: chat + replay + sample, chat, replay, sample };
}

@Injectable()
export class ClearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly registry: OrchestratorRegistry,
  ) {}

  /** What clearing now would delete, broken down by kind (no writes). */
  async preview(input: { userId: string }): Promise<ClearBreakdown> {
    const now = this.clock.now();
    const rows = (await this.prisma.db.inference.findMany({
      where: { userId: input.userId, startedAt: { lt: now } },
    })) as unknown as InfRow[];
    return breakdownOf(rows);
  }

  async execute(input: { userId: string }): Promise<ClearBreakdown> {
    const fence = this.clock.now();

    // 1. Fence first (its own committed transaction).
    await this.prisma.db.$transaction(async (tx) => {
      await tx.userClearFence.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId, clearAfterTs: fence },
        update: { clearAfterTs: fence },
      });
    });

    // 2. Cancel everything in flight and wait for terminal writes to land.
    await this.registry.cancelAll(input.userId);

    // 3. Count + delete atomically, strictly after all cancels resolved.
    return this.prisma.db.$transaction(async (tx) => {
      const rows = (await tx.inference.findMany({
        where: { userId: input.userId, startedAt: { lt: fence } },
      })) as unknown as InfRow[];
      const breakdown = breakdownOf(rows);
      await tx.inference.deleteMany({ where: { userId: input.userId, startedAt: { lt: fence } } });
      await tx.traceEvent.deleteMany({ where: { userId: input.userId, createdAt: { lt: fence } } });
      return breakdown;
    });
  }
}
