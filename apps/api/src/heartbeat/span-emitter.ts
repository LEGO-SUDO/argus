// span-emitter — emits one synthetic OTel span carrying `llm.kind='heartbeat'`.
//
// The projection consumer writes this into trace_events (kind='heartbeat'),
// which the live-badge service reads as its ingestion-health truth source. A
// pure helper over an injected tracer + clock so it's unit-testable with a stub.
import type { Tracer } from '@opentelemetry/api';
import { OTEL_ATTRS } from '@argus/contracts';
import type { ClockLike } from '../common/clock';

export const HEARTBEAT_SPAN_NAME = 'llm.heartbeat';
export const HEARTBEAT_EVENT_NAME = 'llm.heartbeat';

export function emitHeartbeatSpan(tracer: Tracer, clock: ClockLike): void {
  const at = clock.now();
  const span = tracer.startSpan(HEARTBEAT_SPAN_NAME, {
    startTime: at,
    attributes: { [OTEL_ATTRS.LLM_KIND]: 'heartbeat' },
  });
  // INFRA's span-mapper builds trace_events rows from span.events[] ONLY — a
  // zero-event span yields no row, so the live-badge would never see a
  // heartbeat. Record exactly one named event so each span lands exactly one
  // trace_events row (deduped on redelivery via UNIQUE(trace_id,span_id,name)).
  span.addEvent(HEARTBEAT_EVENT_NAME, { [OTEL_ATTRS.LLM_KIND]: 'heartbeat' }, at);
  span.end(at);
}
