// LiveBadgeService — computes the ingestion-health badge from the freshest
// heartbeat trace event (DB-as-truth, MAX(created_at) WHERE kind='heartbeat').
//
// The badge is GLOBAL (a single ingestion-health signal across all users —
// heartbeats are emitted system-wide), served as a 1s REST poll on
// GET /console/live/badge. Thresholds come from config:
//   lag < green                -> live
//   green <= lag < error       -> behind
//   lag >= error               -> error ("ingestion behind")
//   no heartbeat rows at all    -> live (no traffic == fresh, per PRD)
//   query throws (DB down)      -> error ("DB unreachable")
import { Inject, Injectable } from '@nestjs/common';
import type { LiveBadgeState } from '@argus/contracts';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';

@Injectable()
export class LiveBadgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  async state(): Promise<LiveBadgeState> {
    let latest: Date | null;
    try {
      const rows = (await this.prisma.db.traceEvent.findMany({
        where: { kind: 'heartbeat' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })) as unknown as Array<{ createdAt: Date }>;
      latest = rows[0]?.createdAt ?? null;
    } catch (err) {
      captureApiError({ err, feature: 'live', layer: 'service', extra: { stage: 'badge-query' } });
      return { state: 'error', message: 'DB unreachable' };
    }

    // No heartbeat rows == fresh / no traffic (PRD).
    if (!latest) return { state: 'live', lagSeconds: 0 };

    const lagMs = Math.max(0, this.clock.nowMs() - latest.getTime());
    const lagSeconds = Math.round(lagMs / 1000);
    if (lagMs >= this.config.liveBadgeErrorThresholdMs) {
      return { state: 'error', message: 'ingestion behind', lagSeconds };
    }
    if (lagMs >= this.config.liveBadgeGreenThresholdMs) {
      return { state: 'behind', lagSeconds };
    }
    return { state: 'live', lagSeconds };
  }
}
