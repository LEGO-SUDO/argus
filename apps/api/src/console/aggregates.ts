// Aggregates — the single place every kind-filtered cost / throughput / error
// rate / sparkline computation lives. Centralizing the predicate keeps the
// "default reads exclude replay/sample/classifier/heartbeat" invariant in one
// auditable spot (CONTRACTS.md: every default aggregate filters on `kind`).
//
// Implemented as portable TS aggregation over `inference.findMany` (not raw
// SQL) so the same code runs against the in-memory test fixture and real
// Postgres. The where-clause does the heavy lifting (kind/provider/window/
// sample-visibility); the summing/bucketing happens in TS over the result set,
// which the cost surfaces need anyway (missing-pricing + sparkline backfill).
import { Injectable } from '@nestjs/common';
import type { TimeWindow, SparklinePoint } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';

type Kind = 'chat' | 'classifier' | 'replay' | 'sample' | 'heartbeat' | 'unknown';

interface InferenceRowView {
  conversationId: string;
  provider: string;
  model: string;
  status: string;
  kind: Kind;
  promptTokens: number | null;
  completionTokens: number | null;
  promptCostUsdMicros: number | null;
  completionCostUsdMicros: number | null;
  startedAt: Date;
  sampleWorkspaceId: string | null;
}

export interface AggregateOptions {
  userId: string;
  window: TimeWindow;
  includeReplay?: boolean;
  includeSample?: boolean;
  includeMock?: boolean;
  /** The session's active sample workspace — gates sample-row visibility. */
  currentSampleWorkspaceId?: string | null;
}

export type CostGroupKey = 'conversationId' | 'provider' | 'model';

export interface CostGroupAggregate {
  key: string;
  promptCostMicros: number;
  completionCostMicros: number;
  totalCostMicros: number;
  unpricedCount: number;
  unpricedModels: string[];
}

export interface CostAggregateResult {
  groups: CostGroupAggregate[];
  totalMicroUsd: number;
  unpricedModels: string[];
}

export interface ThroughputResult {
  turnsPerHour: number;
  tokensPerHour: number;
  errorRate: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function rowIsPriced(r: InferenceRowView): boolean {
  return r.promptCostUsdMicros !== null || r.completionCostUsdMicros !== null;
}

function rowCostMicros(r: InferenceRowView): number {
  return (r.promptCostUsdMicros ?? 0) + (r.completionCostUsdMicros ?? 0);
}

@Injectable()
export class Aggregates {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** Allowed kinds: chat by default; toggles additively widen to replay/sample. */
  private allowedKinds(opts: AggregateOptions): Kind[] {
    const kinds: Kind[] = ['chat'];
    if (opts.includeReplay) kinds.push('replay');
    if (opts.includeSample) kinds.push('sample');
    return kinds;
  }

  private windowCutoff(window: TimeWindow): Date | null {
    if (window === 'all') return null;
    const span = window === '24h' ? 24 * HOUR_MS : 7 * DAY_MS;
    return new Date(this.clock.nowMs() - span);
  }

  /** The shared kind/provider/window/sample-visibility filtered row set. */
  private async fetchRows(opts: AggregateOptions): Promise<InferenceRowView[]> {
    const where: Record<string, unknown> = {
      userId: opts.userId,
      kind: { in: this.allowedKinds(opts) },
      // Sample rows are visible only when they belong to the session's active
      // workspace; non-sample rows are always visible.
      OR: [{ kind: { not: 'sample' } }, { sampleWorkspaceId: opts.currentSampleWorkspaceId ?? null }],
    };
    const cutoff = this.windowCutoff(opts.window);
    if (cutoff) where.startedAt = { gte: cutoff };
    if (!opts.includeMock) where.provider = { not: 'mock' };
    return (await this.prisma.db.inference.findMany({ where })) as unknown as InferenceRowView[];
  }

  async costGrouped(opts: AggregateOptions, by: CostGroupKey = 'conversationId'): Promise<CostAggregateResult> {
    const rows = await this.fetchRows(opts);
    const groups = new Map<string, CostGroupAggregate>();
    const globalUnpriced = new Set<string>();

    for (const r of rows) {
      const key = String(r[by]);
      let g = groups.get(key);
      if (!g) {
        g = { key, promptCostMicros: 0, completionCostMicros: 0, totalCostMicros: 0, unpricedCount: 0, unpricedModels: [] };
        groups.set(key, g);
      }
      if (rowIsPriced(r)) {
        g.promptCostMicros += r.promptCostUsdMicros ?? 0;
        g.completionCostMicros += r.completionCostUsdMicros ?? 0;
        g.totalCostMicros += rowCostMicros(r);
      } else {
        g.unpricedCount += 1;
        if (!g.unpricedModels.includes(r.model)) g.unpricedModels.push(r.model);
        globalUnpriced.add(r.model);
      }
    }

    const groupList = [...groups.values()].sort((a, b) => b.totalCostMicros - a.totalCostMicros);
    const totalMicroUsd = groupList.reduce((sum, g) => sum + g.totalCostMicros, 0);
    return { groups: groupList, totalMicroUsd, unpricedModels: [...globalUnpriced] };
  }

  async costByConversation(opts: AggregateOptions): Promise<CostAggregateResult> {
    return this.costGrouped(opts, 'conversationId');
  }

  /** Throughput + error rate over chat rows only (HLD aggregates). */
  async throughputForUser(opts: AggregateOptions): Promise<ThroughputResult> {
    const chatOnly: AggregateOptions = { ...opts, includeReplay: false, includeSample: false };
    const rows = (await this.fetchRows(chatOnly)).filter((r) => r.kind === 'chat');
    const hours = this.windowHours(opts.window, rows);
    const turns = rows.length;
    const tokens = rows.reduce((n, r) => n + (r.promptTokens ?? 0) + (r.completionTokens ?? 0), 0);
    return {
      turnsPerHour: hours > 0 ? turns / hours : 0,
      tokensPerHour: hours > 0 ? tokens / hours : 0,
      errorRate: this.errorRateFrom(rows),
    };
  }

  async errorRate(opts: AggregateOptions): Promise<number> {
    const chatOnly: AggregateOptions = { ...opts, includeReplay: false, includeSample: false };
    const rows = (await this.fetchRows(chatOnly)).filter((r) => r.kind === 'chat');
    return this.errorRateFrom(rows);
  }

  // (failed + timed_out) / total_chat_rows — canceled + ok + streaming are not
  // errors; guards divide-by-zero by returning 0. `timed_out` is not in the DB
  // status enum today, so in practice the numerator is the `failed` count.
  private errorRateFrom(rows: InferenceRowView[]): number {
    if (rows.length === 0) return 0;
    const errors = rows.filter((r) => r.status === 'failed' || r.status === 'timed_out').length;
    return errors / rows.length;
  }

  private windowHours(window: TimeWindow, rows: InferenceRowView[]): number {
    if (window === '24h') return 24;
    if (window === '7d') return 24 * 7;
    // 'all' — span from the earliest row to now, floored at 1 hour.
    if (rows.length === 0) return 1;
    const earliest = Math.min(...rows.map((r) => r.startedAt.getTime()));
    return Math.max(1, (this.clock.nowMs() - earliest) / HOUR_MS);
  }

  /**
   * Per-bucket spend across the window, chronological, with empty buckets
   * backfilled to zero. Hourly buckets; for window='all' spanning >30 days the
   * buckets downsample to per-day (Open Question resolution).
   */
  async sparkline(opts: AggregateOptions): Promise<SparklinePoint[]> {
    const rows = await this.fetchRows(opts);
    const now = this.clock.nowMs();
    const cutoff = this.windowCutoff(opts.window);

    let start: number;
    if (cutoff) {
      start = cutoff.getTime();
    } else if (rows.length > 0) {
      start = Math.min(...rows.map((r) => r.startedAt.getTime()));
    } else {
      return [];
    }

    const bucketMs = !cutoff && now - start > 30 * DAY_MS ? DAY_MS : HOUR_MS;
    const firstBucket = Math.floor(start / bucketMs) * bucketMs;
    const lastBucket = Math.floor(now / bucketMs) * bucketMs;

    const sums = new Map<number, number>();
    for (const r of rows) {
      const b = Math.floor(r.startedAt.getTime() / bucketMs) * bucketMs;
      sums.set(b, (sums.get(b) ?? 0) + rowCostMicros(r));
    }

    const points: SparklinePoint[] = [];
    for (let b = firstBucket; b <= lastBucket; b += bucketMs) {
      points.push({ hourStart: new Date(b).toISOString(), costMicros: sums.get(b) ?? 0 });
    }
    return points;
  }
}
