import { emitHeartbeatSpan, HEARTBEAT_SPAN_NAME, HEARTBEAT_EVENT_NAME } from '../../src/heartbeat/span-emitter';
import { FakeClock } from '../../src/common/clock';
import type { Tracer } from '@opentelemetry/api';

describe('emitHeartbeatSpan', () => {
  it('starts one span with llm.kind=heartbeat, records one named event at the clock time, then ends it', () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const end = jest.fn();
    const addEvent = jest.fn();
    const startSpan = jest.fn(() => ({ end, addEvent, setAttribute: jest.fn() }));
    const tracer = { startSpan } as unknown as Tracer;

    emitHeartbeatSpan(tracer, new FakeClock(now));

    expect(startSpan).toHaveBeenCalledTimes(1);
    const [name, options] = startSpan.mock.calls[0]!;
    expect(name).toBe(HEARTBEAT_SPAN_NAME);
    expect((options as { attributes: Record<string, unknown> }).attributes['llm.kind']).toBe('heartbeat');
    expect((options as { startTime: Date }).startTime.getTime()).toBe(now.getTime());

    // Exactly one span event so INFRA's mapper produces a trace_events row.
    expect(addEvent).toHaveBeenCalledTimes(1);
    const [evName, evAttrs, evTime] = addEvent.mock.calls[0]!;
    expect(evName).toBe(HEARTBEAT_EVENT_NAME);
    expect((evAttrs as Record<string, unknown>)['llm.kind']).toBe('heartbeat');
    expect((evTime as Date).getTime()).toBe(now.getTime());

    expect(end).toHaveBeenCalledTimes(1);
  });
});
