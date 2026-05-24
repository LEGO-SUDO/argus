// Redpanda projection consumer.
//
// One kafkajs consumer per process, subscribed to `traces` topic, consumer
// group `argus-projection`. Each batch is parsed as OTLP-JSON and the
// contained spans are handed to ProjectionService.handle.
//
// Wire format: OTLP-JSON only.
//   - The OTel Collector is configured `encoding: otlp_json` (see
//     infra/otel/collector.yaml). This Phase-A choice keeps the consumer
//     decoder a one-line `JSON.parse` and lets hand-fabricated smoke
//     records work via `rpk topic produce`.
//   - WOULD DO NEXT (production-realism): switch the Collector to
//     `otlp_proto` for smaller wire size and add a protobuf decode path
//     here using `@opentelemetry/otlp-transformer`'s request
//     deserializer. See README "Phase A tradeoffs" for the rationale.
//
// Lifecycle:
//   - onModuleInit:    connect + subscribe + run (enable.auto.commit=false)
//   - onModuleDestroy: disconnect cleanly so containers exit gracefully
//
// Per sentry-error-observability skill (non-negotiable for non-HTTP
// consumers):
//   - withConsumerScope(...) wraps every batch so captured exceptions carry
//     consumer/topic/partition/offset tags
//   - errors are captured with layer=consumer + recoverable tag
//   - we do NOT silently swallow: handler errors throw so kafkajs retries
//   - permanent failures (parse error) are captured with recoverable=no and
//     dropped (DLQ wiring is Phase B; for now we log + capture loudly)
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  Kafka,
  type Consumer,
  type EachBatchPayload,
  logLevel as kafkaLogLevel,
} from 'kafkajs';
// Lazy import — keeps the type surface narrow and avoids pulling the entire
// transformer module into the test bundle when the consumer is not exercised.
import { OtlpSpanSchema, type OtlpSpan } from '@argus/contracts';
import { ProjectionService } from './projection.service';
import { captureProjectionError, withConsumerScope } from '../observability/sentry';

const CONSUMER_GROUP = 'argus-projection';
const TRACES_TOPIC_DEFAULT = 'traces';

@Injectable()
export class ProjectionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionConsumer.name);
  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;
  private running = false;

  constructor(private readonly service: ProjectionService) {}

  isRunning(): boolean {
    return this.running;
  }

  async onModuleInit(): Promise<void> {
    const brokersEnv = process.env.REDPANDA_BROKERS ?? 'redpanda:9092';
    const brokers = brokersEnv.split(',').map((b) => b.trim()).filter(Boolean);
    const topic = process.env.REDPANDA_TRACES_TOPIC ?? TRACES_TOPIC_DEFAULT;

    if (process.env.WORKERS_DISABLE_CONSUMER === 'true') {
      this.logger.warn(
        'WORKERS_DISABLE_CONSUMER=true — skipping kafkajs connect. ' +
          'This mode is for unit tests / local dev without Redpanda.',
      );
      return;
    }

    this.kafka = new Kafka({
      clientId: 'argus-workers',
      brokers,
      logLevel: kafkaLogLevel.WARN,
    });
    this.consumer = this.kafka.consumer({
      groupId: CONSUMER_GROUP,
      // We commit manually after the batch handler resolves.
      // kafkajs does this via heartbeat() + resolveOffset() + commitOffsetsIfNecessary().
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    // Don't await — run() returns a promise that resolves only on disconnect.
    void this.consumer
      .run({
        eachBatchAutoResolve: false,
        autoCommit: false,
        eachBatch: async (payload) => this.handleBatch(payload, topic),
      })
      .catch((err) => {
        this.logger.error(`kafkajs consumer run loop failed: ${String(err)}`);
        captureProjectionError({
          err,
          layer: 'consumer',
          recoverable: 'no',
          extra: { stage: 'run-loop' },
        });
      });

    this.running = true;
    this.logger.log(`Kafka consumer ready — group=${CONSUMER_GROUP} topic=${topic}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.consumer) return;
    try {
      this.running = false;
      await this.consumer.disconnect();
      this.logger.log('Kafka consumer disconnected cleanly');
    } catch (err) {
      // Log + capture but do not throw — shutdown must proceed.
      captureProjectionError({
        err,
        layer: 'consumer',
        recoverable: 'no',
        extra: { stage: 'shutdown' },
      });
    }
  }

  private async handleBatch(
    payload: EachBatchPayload,
    topic: string,
  ): Promise<void> {
    const { batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale } =
      payload;

    for (const message of batch.messages) {
      if (!isRunning() || isStale()) return;

      await withConsumerScope(
        {
          consumer: CONSUMER_GROUP,
          topic,
          partition: batch.partition,
          offset: message.offset,
          messageKey: message.key?.toString(),
        },
        async () => {
          let spans: OtlpSpan[];
          try {
            spans = this.decode(message.value);
          } catch (err) {
            // Parse errors are non-recoverable for THIS message — re-delivery
            // won't help. Capture loudly, drop, commit, continue.
            captureProjectionError({
              err,
              layer: 'consumer',
              recoverable: 'no',
              extra: { stage: 'decode', offset: message.offset },
            });
            this.logger.error(
              `decode failure at offset=${message.offset} — dropping (DLQ wiring is Phase B)`,
            );
            return;
          }

          for (const span of spans) {
            try {
              await this.service.handle(span);
            } catch (err) {
              // Service-level failure (e.g. DB unavailable). Treat as
              // recoverable: throw so kafkajs retries the batch from this
              // offset on the next run. We do NOT resolveOffset for this
              // message — kafkajs will redeliver.
              captureProjectionError({
                err,
                layer: 'consumer',
                recoverable: 'yes',
                extra: {
                  stage: 'service-handle',
                  traceId: span.traceId,
                  spanId: span.spanId,
                },
              });
              throw err;
            }
          }
        },
      );

      resolveOffset(message.offset);
      await heartbeat();
    }
    await commitOffsetsIfNecessary();
  }

  /**
   * Decode a kafka record value into zero or more OTLP spans.
   *
   * Wire format is OTLP-JSON (see Collector config + file header). A non-JSON
   * record is treated as malformed and surfaces as a parse error to the
   * caller (which captures via Sentry with recoverable=no and drops the
   * record — replay won't fix bad bytes).
   */
  private decode(value: Buffer | null): OtlpSpan[] {
    if (!value) return [];
    const parsed: unknown = JSON.parse(value.toString('utf8'));
    return extractSpans(parsed);
  }
}

/**
 * Walk an OTLP ExportTraceServiceRequest (JSON shape) and yield each span
 * with our attribute-key view (flat `attributes` map) — matching what the
 * mapper expects.
 */
export function extractSpans(parsed: unknown): OtlpSpan[] {
  const out: OtlpSpan[] = [];
  const root = parsed as {
    resourceSpans?: Array<{
      resource?: { attributes?: OtlpKeyValue[] };
      scopeSpans?: Array<{
        spans?: Array<OtlpRawSpan>;
      }>;
    }>;
  };
  if (!root.resourceSpans) {
    // Allow tests to feed a single already-flat span (or array of them).
    if (Array.isArray(parsed)) {
      for (const candidate of parsed) {
        const result = OtlpSpanSchema.safeParse(candidate);
        if (result.success) out.push(preserveRawAttributes(result.data, candidate));
      }
    } else {
      const result = OtlpSpanSchema.safeParse(parsed);
      if (result.success) out.push(preserveRawAttributes(result.data, parsed));
    }
    return out;
  }

  for (const rs of root.resourceSpans) {
    const resourceAttrs = kvToMap(rs.resource?.attributes ?? []);
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        const spanAttrs = kvToMap(sp.attributes ?? []);
        const merged = { ...resourceAttrs, ...spanAttrs };
        const candidate = {
          traceId: sp.traceId,
          spanId: sp.spanId,
          name: sp.name,
          startTimeUnixNano: sp.startTimeUnixNano,
          endTimeUnixNano: sp.endTimeUnixNano,
          attributes: merged,
          events: (sp.events ?? []).map((e) => ({
            name: e.name,
            timeUnixNano: e.timeUnixNano,
            attributes: kvToMap(e.attributes ?? []),
            body: e.body,
          })),
          status: sp.status,
        };
        const result = OtlpSpanSchema.safeParse(candidate);
        if (result.success) out.push(preserveRawAttributes(result.data, candidate));
      }
    }
  }
  return out;
}

/**
 * Re-attach the raw (un-stripped) attribute map onto a validated span.
 *
 * Phase B control-plane attributes (`llm.kind` + the FK attrs) are not declared
 * in the contracts-owned OtelAttributesSchema, so zod strips them from
 * `result.data`. The validated values for the declared keys are identical to
 * the raw map, so we merge the raw attributes UNDER the validated ones: declared
 * keys keep their validated values, Phase B keys survive for the mapper.
 */
function preserveRawAttributes(span: OtlpSpan, candidate: unknown): OtlpSpan {
  const rawAttrs = (candidate as { attributes?: unknown } | null)?.attributes;
  if (!rawAttrs || typeof rawAttrs !== 'object') return span;
  return {
    ...span,
    attributes: {
      ...(rawAttrs as Record<string, unknown>),
      ...span.attributes,
    } as OtlpSpan['attributes'],
  };
}

interface OtlpRawSpan {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string | number;
  endTimeUnixNano: string | number;
  attributes?: OtlpKeyValue[];
  events?: Array<{
    name: string;
    timeUnixNano?: string | number;
    attributes?: OtlpKeyValue[];
    body?: unknown;
  }>;
  status?: { code?: number; message?: string };
}

interface OtlpKeyValue {
  key: string;
  value:
    | { stringValue?: string }
    | { intValue?: number | string }
    | { doubleValue?: number }
    | { boolValue?: boolean }
    | unknown;
}

function kvToMap(kvs: OtlpKeyValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of kvs) {
    out[kv.key] = unwrapValue(kv.value);
  }
  return out;
}

function unwrapValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if ('stringValue' in o) return o.stringValue;
  if ('intValue' in o) {
    const iv = o.intValue;
    return typeof iv === 'string' ? Number(iv) : iv;
  }
  if ('doubleValue' in o) return o.doubleValue;
  if ('boolValue' in o) return o.boolValue;
  return v;
}
