// Phase B service lifecycle — extracted from main.ts so it's unit-testable
// (signal-handler tests against main.ts directly are flaky).
//
// start: janitor + heartbeat schedulers, then the live-events consumer. The
// consumer's Kafka connect is best-effort — a broker outage degrades SSE to
// "no live ticks" but must NOT block API boot (the REST badge still works).
// stop: reverse order so the consumer drains before the schedulers halt.
import type { INestApplicationContext } from '@nestjs/common';
import { JanitorScheduler } from '../janitor/scheduler';
import { HeartbeatScheduler } from '../heartbeat/scheduler';
import { LiveEventsConsumer } from '../console/live-events.consumer';
import { captureApiError } from '../observability/sentry';

export interface PhaseBLifecycle {
  janitor: Pick<JanitorScheduler, 'start' | 'stop'>;
  heartbeat: Pick<HeartbeatScheduler, 'start' | 'stop'>;
  liveEvents: Pick<LiveEventsConsumer, 'start' | 'stop'>;
}

export function resolvePhaseBLifecycle(app: INestApplicationContext): PhaseBLifecycle {
  return {
    janitor: app.get(JanitorScheduler),
    heartbeat: app.get(HeartbeatScheduler),
    liveEvents: app.get(LiveEventsConsumer),
  };
}

export async function startPhaseBServices(services: PhaseBLifecycle): Promise<void> {
  services.janitor.start();
  services.heartbeat.start();
  try {
    await services.liveEvents.start();
  } catch (err) {
    // SSE degrades to next-refetch; never block boot on a missing broker.
    captureApiError({ err, feature: 'live', layer: 'service', extra: { stage: 'consumer-start' } });
  }
}

export async function stopPhaseBServices(services: PhaseBLifecycle): Promise<void> {
  try {
    await services.liveEvents.stop();
  } catch (err) {
    captureApiError({ err, feature: 'live', layer: 'service', extra: { stage: 'consumer-stop' } });
  }
  services.heartbeat.stop();
  services.janitor.stop();
}
