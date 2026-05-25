// LiveEventsPublisher — publishes one snake_case record to the Kafka
// `live-events` topic AFTER a chat/replay/sample turn commits to Postgres
// (HLD D3). The api `live-events` consumer (group `api-live-fanout`) fans it out
// over SSE so the console refetches.
//
// Load-bearing contract (CONTRACTS.md §live-events publish ordering):
//   - Publish ONLY after the DB commit, never before, never on failure, never
//     on a duplicate redelivery (the trace_events idempotency gate filters
//     those out before this is ever called).
//   - "Awaited with internal error swallowing": the projection service awaits
//     publish() so a synchronous failure surfaces in-batch, but this class
//     catches its own kafkajs `send` errors internally (Sentry recoverable=yes)
//     and resolves cleanly — a missed tick degrades to the user's next refetch;
//     it NEVER rolls back the already-committed DB write.
//   - Payload is snake_case `{ user_id, kind, conversation_id }`; record key =
//     user_id (per-user ordering across partitions).
//
// DI: the Kafka client is injected (built from env by the Nest provider in
// projection.module.ts) so tests can hand in a mocked kafkajs producer.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kafka, Producer } from 'kafkajs';
import { LiveEventsPayload, type LiveEventsPayloadValue } from '@argus/contracts';
import { captureProjectionError } from '../observability/sentry';

export const LIVE_EVENTS_TOPIC_DEFAULT = 'live-events';

@Injectable()
export class LiveEventsPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveEventsPublisher.name);
  private readonly producer: Producer;
  private readonly topic: string;
  private connected = false;

  constructor(kafka: Kafka) {
    this.producer = kafka.producer({ allowAutoTopicCreation: false });
    this.topic = process.env.REDPANDA_LIVE_EVENTS_TOPIC ?? LIVE_EVENTS_TOPIC_DEFAULT;
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.connected = true;
    this.logger.log(`live-events publisher ready — topic=${this.topic}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.disconnect();
      this.connected = false;
      this.logger.log('live-events publisher disconnected cleanly');
    } catch (err) {
      // Shutdown must proceed — capture but never throw.
      captureProjectionError({
        err,
        layer: 'projection',
        recoverable: 'no',
        extra: { stage: 'live-events-disconnect' },
      });
    }
  }

  /**
   * Publish one tick. Awaited by the caller, but swallows its own send errors:
   * a Kafka outage degrades to a missed tick (Sentry recoverable=yes), never a
   * DB rollback.
   */
  async publish(payload: LiveEventsPayloadValue): Promise<void> {
    try {
      // Validate + normalize to the snake_case contract shape before the wire.
      const value = LiveEventsPayload.parse(payload);
      await this.producer.send({
        topic: this.topic,
        messages: [{ key: value.user_id, value: JSON.stringify(value) }],
      });
    } catch (err) {
      captureProjectionError({
        err,
        layer: 'projection',
        recoverable: 'yes',
        extra: {
          stage: 'live-events-publish',
          userId: payload.user_id,
          kind: payload.kind,
          conversationId: payload.conversation_id,
        },
      });
      // Swallow — do NOT re-throw (the DB write already committed).
    }
  }
}
