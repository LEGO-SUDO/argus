// LiveController — GET /console/live, the long-lived SSE stream. Owns this
// path EXCLUSIVELY (ConsoleController must never register it).
//
// Lifecycle: handshake headers + `retry:` directive → initial badge state (so
// the client renders before any tick) → SseHub subscription (per-user ticks) →
// keep-alive comment pings at half the heartbeat cadence → cleanup (unsubscribe
// + clear ping) on client disconnect. SessionGuard runs first, so an
// unauthenticated request 401s without opening a stream.
import { Controller, Get, Inject, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { LiveBadgeService } from './live-badge.service';
import { SseHub } from './sse-hub';
import { encodeSseComment, encodeSseData } from './sse-event';

@Controller('console')
export class LiveController {
  constructor(
    private readonly liveBadge: LiveBadgeService,
    private readonly hub: SseHub,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  @Get('live')
  @UseGuards(SessionGuard)
  async live(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const userId = req.user!.id;

    // Handshake.
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');

    // Initial badge state so the client can render before the first tick.
    const badge = await this.liveBadge.state();
    res.write(encodeSseData(badge));

    // Per-user subscription.
    const unsubscribe = this.hub.subscribe(userId, (tick) => {
      res.write(encodeSseData(tick));
    });

    // Keep-alive comment ping at half the heartbeat cadence (stays ahead of
    // intermediary idle timeouts; not a `data:` event).
    const ping = setInterval(() => res.write(encodeSseComment('ping')), this.config.heartbeatIntervalMs / 2);
    ping.unref?.();

    // Cleanup on disconnect.
    req.on('close', () => {
      unsubscribe();
      clearInterval(ping);
      res.end();
    });
  }
}
