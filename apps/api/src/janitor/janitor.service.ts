// JanitorService — sweeps stranded streaming inferences left behind by an api
// restart (the orchestrator that owned them died, so the projection consumer
// will never enrich them to a terminal state).
//
// Predicate keys on `updated_at` (HLD D9 — not started_at, so a long-running
// stream that's still ticking is left alone), status='streaming', and the
// user-originated kinds only (chat/replay/sample). classifier + heartbeat are
// synchronous/synthetic and should never be streaming — surviving ones signal
// a different bug, not the janitor's job.
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Clock } from '../common/clock';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';

const SWEPT_KINDS = ['chat', 'replay', 'sample'] as const;

@Injectable()
export class JanitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  /** Mark stranded streaming rows failed. Returns the number swept. */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - this.config.janitorStrandedThresholdMs);
    try {
      const res = await this.prisma.db.inference.updateMany({
        where: {
          status: 'streaming',
          kind: { in: [...SWEPT_KINDS] },
          updatedAt: { lt: cutoff },
        },
        data: { status: 'failed', errorCode: 'api_restart', endedAt: now },
      });
      return res.count;
    } catch (err) {
      // Capture and let the next interval retry — no back-off (single-replica demo).
      captureApiError({ err, feature: 'janitor', layer: 'service', extra: { stage: 'sweep' } });
      return 0;
    }
  }
}
