// LiveEventsConsumer — kafkajs consumer on the `live-events` topic (group
// `api-live-fanout`). For each message it parses the snake_case payload against
// the contract schema and fans it out through the SseHub; a malformed payload
// is captured and skipped so a single bad record never stalls the stream.
//
// start()/stop() are driven explicitly by main.ts (not a module bootstrap
// hook) so DI tests + a double-start can't trigger a real Kafka connection.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kafka, type Consumer } from 'kafkajs';
import { LiveEventPayloadSchema } from '@argus/contracts';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';
import { SseHub } from './sse-hub';
import { toSseTick } from './sse-event';

@Injectable()
export class LiveEventsConsumer {
  private readonly logger = new Logger(LiveEventsConsumer.name);
  private consumer: Consumer | null = null;

  constructor(
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
    private readonly hub: SseHub,
  ) {}

  async start(brokers?: string[]): Promise<void> {
    if (this.consumer) return;
    const list = brokers ?? (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((s) => s.trim());
    const kafka = new Kafka({ clientId: 'argus-api-live-fanout', brokers: list });
    this.consumer = kafka.consumer({ groupId: this.config.liveEventsConsumerGroup });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.config.liveEventsTopic, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        this.handleMessage(message.value);
      },
    });
    this.logger.log(`live-events consumer subscribed to ${this.config.liveEventsTopic}`);
  }

  async stop(): Promise<void> {
    if (!this.consumer) return;
    try {
      await this.consumer.disconnect();
    } finally {
      this.consumer = null;
    }
  }

  /** Decode one Kafka message value and fan it out. Capture-and-skip on error. */
  handleMessage(raw: Buffer | string | null | undefined): void {
    if (raw == null) return;
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch (err) {
      captureApiError({ err, feature: 'live', layer: 'service', extra: { stage: 'json-parse' } });
      return;
    }
    const parsed = LiveEventPayloadSchema.safeParse(json);
    if (!parsed.success) {
      captureApiError({
        err: new Error('invalid_live_event'),
        feature: 'live',
        layer: 'service',
        extra: { stage: 'schema-parse', issues: parsed.error.issues.map((i) => i.message).join(';') },
      });
      return;
    }
    const { user_id, kind, conversation_id } = parsed.data;
    this.hub.publish(user_id, toSseTick(user_id, kind, conversation_id));
  }
}
