// ConsoleController — the `/console/*` REST surface (bare paths, no /api
// prefix; the Next rewrite adds /api browser-side).
//
// Does NOT own GET /console/live — that long-lived SSE route is exclusive to
// LiveController. This controller owns the Traces / Cost / Replay reads,
// Generate-Samples, Clear (preview + execute), and the live-badge REST poll.
// Every handler is SessionGuard-protected and reads the user id off req.user;
// zod validation failures map to Phase A's `{ error: { code, message } }`
// envelope via BadRequestException.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  TracesQuerySchema,
  CostQuerySchema,
  ReplayCandidatesQuerySchema,
  ReplayRunRequestSchema,
  GenerateSamplesRequestSchema,
  ClearExecuteRequestSchema,
  type TraceListResponse,
  type CostResponse,
  type ReplayCandidatesResponse,
  type ReplayDetail,
  type ReplayRunResponse,
  type SampleGenerateResponse,
  type ClearBreakdown,
  type BadgeLagResponse,
} from '@argus/contracts';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { PrismaService } from '../common/prisma.service';
import { TracesRepository } from './traces.repository';
import { CostRepository } from './cost.repository';
import { ReplayRepository } from './replay.repository';
import { Aggregates } from './aggregates';
import { SamplesService } from './samples.service';
import { ClearService } from './clear.service';
import { LiveBadgeService } from './live-badge.service';
import { ReplayService, IneligibleReplayError, ReplaySourceNotFoundError } from '../replay/replay.service';

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ error: { code: 'invalid_request', message } });
}
function notFound(message = 'Not found'): NotFoundException {
  return new NotFoundException({ error: { code: 'not_found', message } });
}

@Controller('console')
@UseGuards(SessionGuard)
export class ConsoleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly traces: TracesRepository,
    private readonly cost: CostRepository,
    private readonly replayRepo: ReplayRepository,
    private readonly aggregates: Aggregates,
    private readonly samples: SamplesService,
    private readonly clear: ClearService,
    private readonly liveBadge: LiveBadgeService,
    private readonly replayService: ReplayService,
  ) {}

  @Get('traces')
  async getTraces(@Req() req: AuthenticatedRequest, @Query() query: unknown): Promise<TraceListResponse> {
    const parsed = TracesQuerySchema.safeParse(query);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid query');
    const userId = req.user!.id;
    const q = parsed.data;
    const { rows, nextCursor } = await this.traces.list({ userId, ...q });
    const throughput = await this.aggregates.throughputForUser({ userId, window: q.window });
    return { rows, throughput, next_cursor: nextCursor };
  }

  @Get('cost')
  async getCost(@Req() req: AuthenticatedRequest, @Query() query: unknown): Promise<CostResponse> {
    const parsed = CostQuerySchema.safeParse(query);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid query');
    const userId = req.user!.id;
    const q = parsed.data;
    const currentSampleWorkspaceId = await this.resolveSampleWorkspace(userId);
    const aggOpts = {
      userId,
      window: q.window,
      includeReplay: q.includeReplay,
      includeMock: q.includeMock,
      includeSample: q.includeSample,
      currentSampleWorkspaceId,
    };
    const { groups, totalMicroUsd, unpricedModels } = await this.cost.groupBy({ ...aggOpts, groupBy: q.groupBy });
    const sparkline = await this.aggregates.sparkline(aggOpts);
    return { groups, total_micro_usd: totalMicroUsd, sparkline, unpriced_models: unpricedModels };
  }

  @Get('replay/candidates')
  async getReplayCandidates(@Req() req: AuthenticatedRequest, @Query() query: unknown): Promise<ReplayCandidatesResponse> {
    const parsed = ReplayCandidatesQuerySchema.safeParse(query);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid query');
    const { candidates, nextCursor } = await this.replayRepo.candidates({ userId: req.user!.id, ...parsed.data });
    return { candidates, next_cursor: nextCursor };
  }

  @Get('replay/:id')
  async getReplayDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ReplayDetail> {
    const detail = await this.replayRepo.detail({ userId: req.user!.id, id });
    if (!detail) throw notFound('Inference not found');
    return detail;
  }

  @Post('replay/run')
  @HttpCode(HttpStatus.OK)
  async postReplayRun(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<ReplayRunResponse> {
    const parsed = ReplayRunRequestSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');
    try {
      return await this.replayService.run({ userId: req.user!.id, ...parsed.data });
    } catch (err) {
      if (err instanceof IneligibleReplayError) throw badRequest('Source inference is not eligible for replay');
      if (err instanceof ReplaySourceNotFoundError) throw notFound('Source inference not found');
      throw err;
    }
  }

  @Post('samples/generate')
  @HttpCode(HttpStatus.OK)
  async postSamplesGenerate(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<SampleGenerateResponse> {
    const parsed = GenerateSamplesRequestSchema.safeParse(body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid body');
    return this.samples.generate({ userId: req.user!.id, count: parsed.data.count });
  }

  @Get('clear/preview')
  async getClearPreview(@Req() req: AuthenticatedRequest): Promise<ClearBreakdown> {
    return this.clear.preview({ userId: req.user!.id });
  }

  @Post('clear')
  @HttpCode(HttpStatus.OK)
  async postClear(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<ClearBreakdown> {
    const parsed = ClearExecuteRequestSchema.safeParse(body);
    if (!parsed.success) throw badRequest("Confirmation must be the literal 'CLEAR'");
    return this.clear.execute({ userId: req.user!.id });
  }

  @Get('live/badge')
  async getLiveBadge(): Promise<BadgeLagResponse> {
    // Global ingestion-health signal — not user-scoped.
    return this.liveBadge.state();
  }

  private async resolveSampleWorkspace(userId: string): Promise<string | null> {
    const session = await this.prisma.db.session.findFirst({ where: { userId } });
    return session?.currentSampleWorkspaceId ?? null;
  }
}
