// LiveEventsModule — provides + exports the SseHub and the live-events Kafka
// consumer (plus the typed config they depend on). start()/stop() are invoked
// by main.ts after app.listen(), not by a module bootstrap hook, so the Kafka
// connection only happens in the real process (never during DI tests).
import { Module } from '@nestjs/common';
import { apiConfigProvider } from '../common/config';
import { SseHub } from './sse-hub';
import { LiveEventsConsumer } from './live-events.consumer';

@Module({
  providers: [SseHub, LiveEventsConsumer, apiConfigProvider],
  exports: [SseHub, LiveEventsConsumer],
})
export class LiveEventsModule {}
