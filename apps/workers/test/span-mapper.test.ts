// Task 4 (RED) / Task 5 (GREEN): span-mapper happy path.
//
// Verifies that a representative OTLP span produces:
//   - one inferences UPDATE keyed by message_id carrying tokens, latency,
//     costs, trace_id, span_id
//   - one trace_events INSERT per span event carrying the full input/output
//     payloads under their respective event names
import { OTEL_ATTRS, SPAN_EVENT_NAMES, type OtlpSpan } from '@argus/contracts';
import { mapSpanToProjection } from '../src/projection/span-mapper';

function makeSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
  const startMs = 1_700_000_000_000;
  const endMs = startMs + 1234;
  return {
    traceId: 'trace-abc',
    spanId: 'span-xyz',
    name: 'llm.chat.stream',
    startTimeUnixNano: String(startMs * 1_000_000),
    endTimeUnixNano: String(endMs * 1_000_000),
    attributes: {
      [OTEL_ATTRS.LLM_PROVIDER]: 'openai',
      [OTEL_ATTRS.LLM_MODEL]: 'gpt-4o-mini',
      [OTEL_ATTRS.LLM_PROMPT_TOKENS]: 120,
      [OTEL_ATTRS.LLM_COMPLETION_TOKENS]: 64,
      [OTEL_ATTRS.LLM_STATUS]: 'ok',
      [OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS]: 1800,
      [OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS]: 1280,
      [OTEL_ATTRS.LLM_INPUT_PREVIEW]: 'hello',
      [OTEL_ATTRS.LLM_OUTPUT_PREVIEW]: 'world',
      [OTEL_ATTRS.CONVERSATION_ID]: '11111111-1111-1111-1111-111111111111',
      [OTEL_ATTRS.USER_ID]: '22222222-2222-2222-2222-222222222222',
      [OTEL_ATTRS.MESSAGE_ID]: '33333333-3333-3333-3333-333333333333',
      [OTEL_ATTRS.TURN_INDEX]: 0,
    },
    events: [
      {
        name: SPAN_EVENT_NAMES.LLM_INPUT,
        body: { messages: [{ role: 'user', content: 'hello' }] },
      },
      {
        name: SPAN_EVENT_NAMES.LLM_OUTPUT,
        body: { content: 'world' },
      },
    ],
    ...overrides,
  };
}

describe('mapSpanToProjection', () => {
  it('maps a happy-path span to one inference update + two trace events', () => {
    const span = makeSpan();
    const result = mapSpanToProjection(span);

    expect(result.inference.messageId).toBe('33333333-3333-3333-3333-333333333333');
    expect(result.inference.conversationId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.inference.userId).toBe('22222222-2222-2222-2222-222222222222');
    expect(result.inference.provider).toBe('openai');
    expect(result.inference.model).toBe('gpt-4o-mini');
    expect(result.inference.status).toBe('ok');
    expect(result.inference.promptTokens).toBe(120);
    expect(result.inference.completionTokens).toBe(64);
    expect(result.inference.promptCostUsdMicros).toBe(1800);
    expect(result.inference.completionCostUsdMicros).toBe(1280);
    expect(result.inference.latencyMs).toBe(1234);
    expect(result.inference.traceId).toBe('trace-abc');
    expect(result.inference.spanId).toBe('span-xyz');
    expect(result.inference.inputPreview).toBe('hello');
    expect(result.inference.outputPreview).toBe('world');
    expect(result.inference.startedAt).toBeInstanceOf(Date);
    expect(result.inference.endedAt).toBeInstanceOf(Date);

    expect(result.traceEvents).toHaveLength(2);
    const inputEvt = result.traceEvents.find((e) => e.name === SPAN_EVENT_NAMES.LLM_INPUT);
    const outputEvt = result.traceEvents.find((e) => e.name === SPAN_EVENT_NAMES.LLM_OUTPUT);
    expect(inputEvt).toBeDefined();
    expect(outputEvt).toBeDefined();
    expect(inputEvt?.traceId).toBe('trace-abc');
    expect(inputEvt?.spanId).toBe('span-xyz');
    expect(inputEvt?.messageId).toBe('33333333-3333-3333-3333-333333333333');
    expect(inputEvt?.userId).toBe('22222222-2222-2222-2222-222222222222');
    expect(inputEvt?.payload).toEqual({ messages: [{ role: 'user', content: 'hello' }] });
    expect(outputEvt?.payload).toEqual({ content: 'world' });
  });

  it('passes through error_code on failed spans', () => {
    const span = makeSpan({
      attributes: {
        ...makeSpan().attributes,
        [OTEL_ATTRS.LLM_STATUS]: 'failed',
        [OTEL_ATTRS.LLM_ERROR_CODE]: 'client_disconnected',
      },
    });
    const result = mapSpanToProjection(span);
    expect(result.inference.status).toBe('failed');
    expect(result.inference.errorCode).toBe('client_disconnected');
  });

  // REVIEW-BRIEF Finding 1: production NEVER sets the llm.*_preview attributes;
  // the SDK only emits the body as span EVENTS, where on the real wire the body
  // string is nested under the `body` event attribute. The mapper must derive
  // both preview columns from those events, or Replay's original pane and Traces
  // content-search read NULL. This span omits the preview attributes on purpose.
  it('derives both previews from the body events when no preview attribute is set', () => {
    const base = makeSpan();
    const attrs = { ...base.attributes };
    delete (attrs as Record<string, unknown>)[OTEL_ATTRS.LLM_INPUT_PREVIEW];
    delete (attrs as Record<string, unknown>)[OTEL_ATTRS.LLM_OUTPUT_PREVIEW];
    const span = makeSpan({
      attributes: attrs,
      // Real-wire shape: the payload string rides as the `body` event attribute
      // (input = JSON of the messages; output = the assistant text verbatim).
      events: [
        {
          name: SPAN_EVENT_NAMES.LLM_INPUT,
          attributes: {
            body: JSON.stringify({
              messages: [
                { role: 'system', content: 'be terse' },
                { role: 'user', content: 'what is the capital of France?' },
              ],
            }),
            truncated: false,
          },
        },
        {
          name: SPAN_EVENT_NAMES.LLM_OUTPUT,
          attributes: { body: 'The capital of France is Paris.', truncated: false },
        },
      ],
    });

    const result = mapSpanToProjection(span);
    // input preview = the triggering user message, not the system prompt or raw JSON.
    expect(result.inference.inputPreview).toBe('what is the capital of France?');
    expect(result.inference.outputPreview).toBe('The capital of France is Paris.');
  });

  it('handles missing optional cost/token attributes gracefully', () => {
    const base = makeSpan();
    const attrs = { ...base.attributes };
    delete (attrs as Record<string, unknown>)[OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS];
    delete (attrs as Record<string, unknown>)[OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS];
    const span = makeSpan({ attributes: attrs });
    const result = mapSpanToProjection(span);
    expect(result.inference.promptCostUsdMicros).toBeUndefined();
    expect(result.inference.completionCostUsdMicros).toBeUndefined();
  });
});
