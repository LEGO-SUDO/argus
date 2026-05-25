// ProjectionService — Phase A projection consumer orchestration.
//
// Load-bearing ownership rule (HLD §Component Map):
//   - This service ONLY mutates `inferences` and `trace_events`.
//   - It NEVER touches `messages` — message status is owned synchronously
//     by the API gateway. A lint-style test in
//     projection.service.integration.test.ts greps this file and fails
//     if the forbidden messages-table accessor ever appears in the code.
//
// Per-span flow:
//   1. Validate span shape (zod). Invalid → drop + Sentry recoverable=no.
//   2. mapSpanToProjection(span) → { inference, traceEvents }.
//   3. Try the FIRST trace_event insert as the idempotency gate. P2002 on
//      the unique (trace_id, span_id) index = duplicate delivery → return
//      early WITHOUT touching inferences. This is the only authoritative
//      idempotency check.
//   4. Insert the remaining trace_events (they share the same span_id, so
//      they all duplicate-skip together on a re-delivery).
//   5. Inside one Prisma $transaction:
//      a. Load existing inferences rows for messageId.
//      b. decideInferenceWrite(existing, incoming) → verdict.
//      c. Apply verdict (update existing | create new).
//
// Why trace_events FIRST (inverted from earlier draft):
//   - The unique (trace_id, span_id) index on trace_events is the
//     authoritative dedupe primitive. SELECT-then-INSERT pre-checks have a
//     TOCTOU race window under concurrent consumer workers; the unique
//     index does not.
//   - If the process dies between the trace_events insert and the inference
//     write, redelivery will:
//       a) Get P2002 on the trace_events insert and short-circuit.
//       b) Leave the inferences row potentially un-enriched.
//     That's acceptable: trace_events is the load-bearing record for
//     Phase B Replay (per HLD §Forward-Compat); a missing inference
//     enrichment is a degradation, not data loss.
//
// Postgres tx + P2002 caveat:
//   - We do NOT wrap trace_events inserts inside the inference-update
//     transaction. Postgres aborts a tx on the first constraint violation
//     even if the application catches the error, which would poison the
//     whole tx on a duplicate. Each trace_event insert is its own statement.
import { Injectable, Logger } from '@nestjs/common';
import { type PrismaClient } from '@argus/db';
import {
  type OtlpSpan,
  OtlpSpanSchema,
} from '@argus/contracts';
import { mapSpanToProjection } from './span-mapper';
import { decideInferenceWrite, type ExistingInferenceRow } from './failover-detector';
import { tryInsertTraceEvent } from './idempotency-guard';
import { capSpanEventPayload } from './payload-cap';
import { evaluateClearFence } from './clear-fence';
import { LiveEventsPublisher } from './live-events-publisher';
import { captureProjectionError } from '../observability/sentry';

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly publisher: LiveEventsPublisher,
  ) {}

  async handle(rawSpan: OtlpSpan): Promise<void> {
    const parse = OtlpSpanSchema.safeParse(rawSpan);
    if (!parse.success) {
      captureProjectionError({
        err: new Error('invalid OTLP span shape'),
        layer: 'mapper',
        recoverable: 'no',
        extra: { issues: parse.error.issues },
      });
      return;
    }
    // Phase B enrichment attributes (llm.kind + the FK attrs) are NOT declared
    // in the contracts-owned OtelAttributesSchema, so zod strips them on parse.
    // Re-attach the raw attribute map (same validated values, plus the Phase B
    // keys) so the mapper can read them. extractSpans preserves the superset on
    // the consumer path; direct callers pass spans that already carry the keys.
    const rawAttrs = (rawSpan as { attributes?: Record<string, unknown> }).attributes;
    const span: OtlpSpan = rawAttrs
      ? { ...parse.data, attributes: { ...rawAttrs, ...parse.data.attributes } as OtlpSpan['attributes'] }
      : parse.data;
    const projection = mapSpanToProjection(span);

    // ---- 0. Clear-fence gate (HLD D8) ----
    // Fires BEFORE the trace_events audit insert: a span the user has cleared
    // must leave NO record (Hand-Off Risk §Clear-fence ordering vs audit).
    const fence = await evaluateClearFence(
      this.prisma,
      projection.inference.userId,
      projection.inference.startedAt,
    );
    if (fence.verdict === 'drop') {
      this.logger.warn(
        `[clear-fence] dropping span before fence — user_id=${projection.inference.userId} ` +
          `trace_id=${span.traceId} span_id=${span.spanId} ` +
          `started_at=${projection.inference.startedAt.toISOString()} ` +
          `fence_ts=${fence.fenceTs.toISOString()}`,
      );
      return;
    }

    try {
      // ---- 1. Idempotency gate via trace_events FIRST insert ----
      // The unique (trace_id, span_id) index on trace_events is the
      // authoritative dedupe primitive. We try the first event insert
      // (typically llm.input); P2002 ⇒ duplicate delivery ⇒ short-circuit.
      //
      // If the span has zero events (unusual; mapper produces one per span
      // event), we have no idempotency gate from trace_events — in that
      // case fall through to the inference write, which is itself
      // idempotent because update-in-place rewrites the same values and
      // the only insert branches are gated by failover-detector verdict.
      let firstEventConsumed = false;
      if (projection.traceEvents.length > 0) {
        const first = projection.traceEvents[0]!;
        const capped = capSpanEventPayload(first.payload);
        const verdict = await tryInsertTraceEvent(
          this.prisma,
          {
            ...first,
            payload: capped.payload,
            truncated: capped.truncated,
          },
          projection.inference.kind,
        );
        if (!verdict.proceeded && verdict.reason === 'duplicate') {
          this.logger.debug(
            `skip duplicate span trace_id=${span.traceId} span_id=${span.spanId} ` +
              `(P2002 on trace_events unique index)`,
          );
          return;
        }
        firstEventConsumed = true;
      }

      // ---- 2. Remaining trace_events ----
      // Insert the remaining events. P2002 here would only happen if the
      // FIRST insert raced with another consumer and lost on the same
      // span_id — extremely unlikely, but the guard handles it safely.
      const remaining = firstEventConsumed
        ? projection.traceEvents.slice(1)
        : projection.traceEvents;
      for (const evt of remaining) {
        const capped = capSpanEventPayload(evt.payload);
        await tryInsertTraceEvent(
          this.prisma,
          {
            ...evt,
            payload: capped.payload,
            truncated: capped.truncated,
          },
          projection.inference.kind,
        );
      }

      // ---- 3. Inference write inside a transaction ----
      await this.prisma.$transaction(async (tx) => {
        const existingRaw = await tx.inference.findMany({
          where: { messageId: projection.inference.messageId },
          orderBy: { startedAt: 'desc' },
          select: { id: true, provider: true, status: true, startedAt: true },
        });
        const existing: ExistingInferenceRow[] = existingRaw.map((r) => ({
          id: r.id,
          provider: r.provider,
          status: r.status as ExistingInferenceRow['status'],
          startedAt: r.startedAt,
        }));
        const verdict = decideInferenceWrite(existing, {
          provider: projection.inference.provider,
          status: projection.inference.status,
        });

        if (verdict.kind === 'update-in-place') {
          await tx.inference.update({
            where: { id: verdict.targetRowId },
            data: {
              provider: projection.inference.provider,
              model: projection.inference.model,
              status: projection.inference.status,
              latencyMs: projection.inference.latencyMs,
              promptTokens: projection.inference.promptTokens,
              completionTokens: projection.inference.completionTokens,
              promptCostUsdMicros: projection.inference.promptCostUsdMicros,
              completionCostUsdMicros: projection.inference.completionCostUsdMicros,
              endedAt: projection.inference.endedAt,
              inputPreview: projection.inference.inputPreview,
              outputPreview: projection.inference.outputPreview,
              traceId: projection.inference.traceId,
              spanId: projection.inference.spanId,
              errorCode: projection.inference.errorCode,
              // Phase B columns — written unconditionally from the mapper verdict.
              kind: projection.inference.kind,
              classifierForMessageId: projection.inference.classifierForMessageId,
              replayOfInferenceId: projection.inference.replayOfInferenceId,
              sampleWorkspaceId: projection.inference.sampleWorkspaceId,
            },
          });
          return;
        }

        // Both `insert-failover-attempt` and `insert-placeholder-missing`
        // create a new inferences row. The latter is recoverable: log it
        // so on-call sees a span that arrived before its placeholder.
        if (verdict.kind === 'insert-placeholder-missing') {
          this.logger.warn(
            `inferences placeholder absent for message_id=${projection.inference.messageId}; ` +
              `consumer creating row directly. gateway insert lost or out of order?`,
          );
          captureProjectionError({
            err: new Error('inferences placeholder missing — consumer inserting directly'),
            layer: 'service',
            recoverable: 'yes',
            extra: {
              messageId: projection.inference.messageId,
              traceId: span.traceId,
              spanId: span.spanId,
            },
          });
        }

        await tx.inference.create({
          data: {
            messageId: projection.inference.messageId,
            conversationId: projection.inference.conversationId,
            userId: projection.inference.userId,
            provider: projection.inference.provider,
            model: projection.inference.model,
            status: projection.inference.status,
            latencyMs: projection.inference.latencyMs,
            promptTokens: projection.inference.promptTokens,
            completionTokens: projection.inference.completionTokens,
            promptCostUsdMicros: projection.inference.promptCostUsdMicros,
            completionCostUsdMicros: projection.inference.completionCostUsdMicros,
            startedAt: projection.inference.startedAt,
            endedAt: projection.inference.endedAt,
            inputPreview: projection.inference.inputPreview,
            outputPreview: projection.inference.outputPreview,
            traceId: projection.inference.traceId,
            spanId: projection.inference.spanId,
            errorCode: projection.inference.errorCode,
            // Phase B columns — written unconditionally from the mapper verdict.
            kind: projection.inference.kind,
            classifierForMessageId: projection.inference.classifierForMessageId,
            replayOfInferenceId: projection.inference.replayOfInferenceId,
            sampleWorkspaceId: projection.inference.sampleWorkspaceId,
          },
        });
      });

      // ---- 4. Post-commit live-events publish (HLD D3) ----
      // We only reach this point when the trace_events idempotency gate did NOT
      // short-circuit (a duplicate redelivery returns early above), so a
      // redelivery never double-publishes. The publish is AWAITED so a
      // synchronous failure surfaces in-batch, but the publisher swallows its
      // own kafkajs errors internally — a Kafka outage degrades to a missed
      // tick (Sentry recoverable=yes), it never rolls back the committed write.
      await this.publisher.publish({
        user_id: projection.inference.userId,
        kind: projection.inference.kind,
        conversation_id: projection.inference.conversationId,
      });
    } catch (err) {
      captureProjectionError({
        err: err instanceof Error ? err : new Error(String(err)),
        layer: 'service',
        recoverable: 'yes',
        extra: {
          traceId: span.traceId,
          spanId: span.spanId,
          messageId: projection.inference.messageId,
        },
      });
      throw err;
    }
  }
}
