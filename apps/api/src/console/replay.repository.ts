// ReplayRepository — read methods for the Replay tab (candidates + detail).
//
// Candidates are the user's terminal `kind='chat'` inferences in the window
// (status != streaming — only terminal rows are replayable). Detail returns
// full metadata for one source, including the captured error_code on failed
// sources. Both are user-scoped; detail returns null cross-user (controller →
// 404). Writes happen via ReplayService/ChatService, not here.
import { Injectable, Logger } from '@nestjs/common';
import type {
  TimeWindow,
  ReplayCandidate,
  ReplayDetail,
  InferenceStatus,
  DiffResult,
} from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { config } from '../common/config';
import { replayEligibility } from '../replay/replay-eligibility';
import { computeDiff } from '../replay/diff';

const DEFAULT_LIMIT = 50;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface InfRow {
  id: string;
  messageId: string;
  traceId: string | null;
  conversationId: string;
  provider: string;
  model: string;
  status: string;
  kind: ReplayDetail['kind'];
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
  sampleWorkspaceId: string | null;
  replayOfInferenceId: string | null;
}

export interface CandidatesInput {
  userId: string;
  window: TimeWindow;
  cursor?: string;
  limit?: number;
}

export interface CandidatesResult {
  candidates: ReplayCandidate[];
  nextCursor: string | null;
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
export class ReplayRepository {
  private readonly logger = new Logger(ReplayRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  private cutoff(window: TimeWindow): Date | null {
    if (window === 'all') return null;
    const span = window === '24h' ? 24 * HOUR_MS : 7 * DAY_MS;
    return new Date(this.clock.nowMs() - span);
  }

  async candidates(input: CandidatesInput): Promise<CandidatesResult> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const and: Record<string, unknown>[] = [];
    const where: Record<string, unknown> = {
      userId: input.userId,
      kind: 'chat',
      // Only terminal rows are replayable — streaming is in-flight.
      status: { not: 'streaming' },
    };
    const cutoff = this.cutoff(input.window);
    if (cutoff) where.startedAt = { gte: cutoff };
    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      if (c) and.push({ OR: [{ startedAt: { lt: c.startedAt } }, { startedAt: c.startedAt, id: { lt: c.id } }] });
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
    const candidates = page.map<ReplayCandidate>((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      conversationTitle: titles.get(r.conversationId) ?? null,
      provider: r.provider,
      model: r.model,
      status: r.status as InferenceStatus,
      startedAt: r.startedAt.toISOString(),
      inputPreview: r.inputPreview,
      eligibility: replayEligibility(r.status),
    }));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.startedAt, last.id) : null;
    return { candidates, nextCursor };
  }

  async detail(input: { userId: string; id: string }): Promise<ReplayDetail | null> {
    const r = (await this.prisma.db.inference.findFirst({
      where: { id: input.id, userId: input.userId },
    })) as unknown as InfRow | null;
    if (!r) return null;
    const titles = await this.titleMap(input.userId);
    const traceId = await this.resolveTraceId(r.messageId, r.traceId);
    const priced = r.promptCostUsdMicros !== null || r.completionCostUsdMicros !== null;
    // Output-preview fallback: when projection never populated the column,
    // derive a preview from the persisted message content so the Replay
    // ORIGINAL/REPLAY pane shows output immediately (not just after a diff).
    const outputPreview =
      r.outputPreview ?? (await this.outputPreviewFromMessage(r.messageId, input.userId));
    return {
      id: r.id,
      traceId,
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
      outputPreview,
      errorCode: r.errorCode,
      eligibility: replayEligibility(r.status),
      diff: await this.computeReplayDiff(r, input.userId),
    };
  }

  // Derive an output preview from the message content (trimmed + capped to the
  // 500-char preview convention). Returns null when there's no usable content.
  private async outputPreviewFromMessage(
    messageId: string,
    userId: string,
  ): Promise<string | null> {
    const msg = (await this.prisma.db.message.findFirst({
      where: { id: messageId, userId },
    })) as unknown as { content?: string | null } | null;
    const content = msg?.content?.trim();
    if (!content) return null;
    return content.length > 500 ? content.slice(0, 500) : content;
  }

  // Word-level diff of a terminal replay row's output vs its source's output.
  // This is the read-path that actually surfaces the replay comparison: the
  // run streams asynchronously (ReplayService returns no diff), so the UI polls
  // detail until the replay row is terminal and reads the diff from here.
  // Returns null for non-replay rows, in-flight replays, or when either side's
  // message content is missing.
  private async computeReplayDiff(r: InfRow, userId: string): Promise<DiffResult | null> {
    if (r.kind !== 'replay') return null;
    if (!r.replayOfInferenceId) {
      this.logger.warn(`replay.diff.null id=${r.id} reason=no_replayOfInferenceId`);
      return null;
    }
    const source = (await this.prisma.db.inference.findFirst({
      where: { id: r.replayOfInferenceId, userId },
    })) as unknown as { messageId: string } | null;
    if (!source) {
      this.logger.warn(`replay.diff.null id=${r.id} reason=source_inference_not_found`);
      return null;
    }
    const [replayMsg, sourceMsg] = (await Promise.all([
      this.prisma.db.message.findFirst({ where: { id: r.messageId, userId } }),
      this.prisma.db.message.findFirst({ where: { id: source.messageId, userId } }),
    ])) as unknown as [
      { content: string; status: string } | null,
      { content: string } | null,
    ];
    // A missing message row is anomalous (the replay should have created its
    // own, and the source's must exist) — worth a warn. A still-`streaming`
    // replay message is the NORMAL in-progress case (the console polls until it
    // finalizes), so we stay quiet there to avoid one warn per poll.
    if (!replayMsg || !sourceMsg) {
      this.logger.warn(
        `replay.diff.null id=${r.id} reason=message_missing replayMsg=${replayMsg ? 'present' : 'missing'} sourceMsg=${sourceMsg ? 'present' : 'missing'}`,
      );
      return null;
    }
    // Gate on the replay MESSAGE being terminal (written synchronously when the
    // turn ends) rather than the inference status (set later by async
    // projection) — so the diff is available as soon as output lands.
    if (replayMsg.status === 'streaming') {
      this.logger.debug(`replay.detail.poll id=${r.id} msgStatus=streaming diff=null`);
      return null;
    }
    const diff = computeDiff(sourceMsg.content, replayMsg.content, config.replayOutputSizeCapBytes);
    this.logger.debug(
      `replay.detail.poll id=${r.id} msgStatus=${replayMsg.status} diff=${'changes' in diff ? `${diff.changes.length}changes` : 'tooLarge'}`,
    );
    return diff;
  }

  private async titleMap(userId: string): Promise<Map<string, string>> {
    const convs = await this.prisma.db.conversation.findMany({ where: { userId } });
    return new Map(convs.map((c) => [c.id, c.title]));
  }

  // OTel trace id for the Jaeger deep link — from the inference's trace events
  // (its spans share a trace), falling back to the inference's own trace_id.
  private async resolveTraceId(messageId: string, inferenceTraceId: string | null): Promise<string> {
    const events = (await this.prisma.db.traceEvent.findMany({
      where: { messageId },
    })) as unknown as Array<{ traceId: string | null }>;
    const fromEvent = events.find((e) => e.traceId)?.traceId;
    return fromEvent ?? inferenceTraceId ?? '';
  }
}
