// HeartbeatScheduler — emits a heartbeat span on boot and at the configured
// cadence so the live-badge always has a fresh ingestion-health signal. A span
// emission that throws is captured and swallowed so the interval keeps ticking.
import { Inject, Injectable } from '@nestjs/common';
import { trace, type Tracer } from '@opentelemetry/api';
import { Clock } from '../common/clock';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';
import { emitHeartbeatSpan } from './span-emitter';

@Injectable()
export class HeartbeatScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly tracer: Tracer = trace.getTracer('argus-api-heartbeat');

  constructor(
    private readonly clock: Clock,
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.heartbeatIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    try {
      emitHeartbeatSpan(this.tracer, this.clock);
    } catch (err) {
      captureApiError({ err, feature: 'heartbeat', layer: 'service', extra: { stage: 'emit' } });
    }
  }
}
