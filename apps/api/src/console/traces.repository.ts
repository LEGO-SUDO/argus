// TracesRepository — read methods for the Traces feed.
//
// User-scoped on every branch; AND-combines provider/model/status/conversation
// filters; free-text search across input/output previews, the joined
// conversation title, and the error code; excludes heartbeat rows by default;
// windowed by `started_at`; cursor-paginated newest-first with an (started_at,
// id) compound cursor. Portable Prisma queries (the in-memory fixture executes
// the same where-clauses).
import { Injectable } from '@nestjs/common';
import type { TimeWindow, TraceRow, InferenceStatus } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';

const DEFAULT_LIMIT = 50;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface TracesListInput {
  userId: string;
  // Multi-select filters — each is ANDed across dimensions, OR-ed (IN) within.
  provider?: string[];
  model?: string[];
  status?: InferenceStatus[];
  conversationId?: string[];
  search?: string;
  window: TimeWindow;
  cursor?: string;
  limit?: number;
}

export interface TracesListResult {
  rows: TraceRow[];
  nextCursor: string | null;
}

interface InfRow {
  id: string;
  messageId: string;
  traceId: string | null;
  conversationId: string;
  provider: string;
  model: string;
  status: string;
  kind: TraceRow['kind'];
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  promptCostUsdMicros: number | null;
  completionCostUsdMicros: number | null;
  startedAt: Date;
  endedAt: Date | null;
  inputPreview: string | null;
  outputPreview: string | null;
  errorCode: string | null;
}

function encodeCursor(startedAt: Date, id: string): string {
  return Buffer.from(`${startedAt.toISOString()}|${id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string): { startedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64').toString('utf8').split('|');
    if (!iso || !id) return null;
    return { startedAt: new Date(iso), id };
  } catch {
    return null;
  }
}

@Injectable()
export class TracesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private cutoff(window: TimeWindow): Date | null {
    if (window === 'all') return null;
    const span = window === '24h' ? 24 * HOUR_MS : 7 * DAY_MS;
    return new Date(this.clock.nowMs() - span);
  }

  async list(input: TracesListInput): Promise<TracesListResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const and: Record<string, unknown>[] = [];

    const where: Record<string, unknown> = {
      userId: input.userId,
      kind: { not: 'heartbeat' },
    };
    // Each present, non-empty filter becomes an IN(...) predicate; the four are
    // ANDed by virtue of being sibling keys on the where object.
    if (input.provider?.length) where.provider = { in: input.provider };
    if (input.model?.length) where.model = { in: input.model };
    if (input.status?.length) where.status = { in: input.status };
    if (input.conversationId?.length) where.conversationId = { in: input.conversationId };

    const cutoff = this.cutoff(input.window);
    if (cutoff) where.startedAt = { gte: cutoff };

    if (input.search) {
      // Title lives on the conversation (no relation column on Inference), so
      // resolve matching conversation ids first, then OR them in.
      const convs = await this.prisma.db.conversation.findMany({
        where: { userId: input.userId, title: { contains: input.search, mode: 'insensitive' } },
      });
      const convIds = convs.map((c) => c.id);
      const searchOr: Record<string, unknown>[] = [
        { inputPreview: { contains: input.search, mode: 'insensitive' } },
        { outputPreview: { contains: input.search, mode: 'insensitive' } },
        { errorCode: { contains: input.search, mode: 'insensitive' } },
      ];
      if (convIds.length) searchOr.push({ conversationId: { in: convIds } });
      and.push({ OR: searchOr });
    }

    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      if (c) {
        and.push({ OR: [{ startedAt: { lt: c.startedAt } }, { startedAt: c.startedAt, id: { lt: c.id } }] });
      }
    }
    if (and.length) where.AND = and;

    const rows = (await this.prisma.db.inference.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })) as unknown as InfRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const titles = await this.titleMap(input.userId);
    const traceIds = await this.traceIdMap(page.map((r) => r.messageId));
    const mapped = page.map((r) => this.toTraceRow(r, titles, traceIds));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.startedAt, last.id) : null;
    return { rows: mapped, nextCursor };
  }

  private async titleMap(userId: string): Promise<Map<string, string>> {
    const convs = await this.prisma.db.conversation.findMany({ where: { userId } });
    return new Map(convs.map((c) => [c.id, c.title]));
  }

  // The OTel trace id lives on the inference's trace events (its spans share a
  // trace). Batch-resolve by messageId for the page; the inference's own
  // trace_id column is the fallback when no trace event exists yet.
  private async traceIdMap(messageIds: string[]): Promise<Map<string, string>> {
    const ids = messageIds.filter((m): m is string => Boolean(m));
    if (ids.length === 0) return new Map();
    const events = (await this.prisma.db.traceEvent.findMany({
      where: { messageId: { in: ids } },
    })) as unknown as Array<{ messageId: string | null; traceId: string | null }>;
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.messageId && e.traceId && !map.has(e.messageId)) map.set(e.messageId, e.traceId);
    }
    return map;
  }

  private toTraceRow(r: InfRow, titles: Map<string, string>, traceIds: Map<string, string>): TraceRow {
    const priced = r.promptCostUsdMicros !== null || r.completionCostUsdMicros !== null;
    return {
      id: r.id,
      traceId: traceIds.get(r.messageId) ?? r.traceId ?? '',
      conversationId: r.conversationId,
      conversationTitle: titles.get(r.conversationId) ?? null,
      provider: r.provider,
      model: r.model,
      status: r.status as InferenceStatus,
      kind: r.kind,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt ? r.endedAt.toISOString() : null,
      latencyMs: r.latencyMs,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      promptCostMicros: r.promptCostUsdMicros,
      completionCostMicros: r.completionCostUsdMicros,
      totalCostMicros: priced ? (r.promptCostUsdMicros ?? 0) + (r.completionCostUsdMicros ?? 0) : null,
      inputPreview: r.inputPreview,
      outputPreview: r.outputPreview,
      errorCode: r.errorCode,
    };
  }
}
