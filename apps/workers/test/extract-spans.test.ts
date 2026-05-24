// Unit test for the consumer's extractSpans helper — parses an OTLP JSON
// ExportTraceServiceRequest into our flat OtlpSpan shape.
//
// Kept separate from projection.consumer.test.ts because the consumer
// requires kafkajs connection and is exercised by the compose smoke test
// (Task 18) — this just verifies the OTLP-JSON -> our-shape mapper.
import { extractSpans } from '../src/projection/projection.consumer';

describe('extractSpans (OTLP-JSON walker)', () => {
  it('parses a single span from a fully-shaped resourceSpans payload', () => {
    const startMs = 1_700_000_000_000;
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aabbccddeeff00112233445566778899',
                  spanId: '0011223344556677',
                  name: 'llm.chat.stream',
                  startTimeUnixNano: String(startMs * 1_000_000),
                  endTimeUnixNano: String((startMs + 500) * 1_000_000),
                  attributes: [
                    { key: 'llm.provider', value: { stringValue: 'openai' } },
                    { key: 'llm.model', value: { stringValue: 'gpt-4o-mini' } },
                    { key: 'llm.prompt_tokens', value: { intValue: '100' } },
                    { key: 'llm.completion_tokens', value: { intValue: '50' } },
                    { key: 'llm.status', value: { stringValue: 'ok' } },
                    {
                      key: 'conversation.id',
                      value: { stringValue: '22222222-2222-2222-2222-222222222222' },
                    },
                    {
                      key: 'user.id',
                      value: { stringValue: '11111111-1111-1111-1111-111111111111' },
                    },
                    {
                      key: 'message.id',
                      value: { stringValue: '44444444-4444-4444-4444-444444444444' },
                    },
                    { key: 'turn.index', value: { intValue: '0' } },
                  ],
                  events: [
                    { name: 'llm.input', body: { messages: [] } },
                    { name: 'llm.output', body: { content: 'hi' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const spans = extractSpans(payload);
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.traceId).toBe('aabbccddeeff00112233445566778899');
    expect(span.spanId).toBe('0011223344556677');
    expect(span.attributes['llm.provider']).toBe('openai');
    expect(span.attributes['llm.prompt_tokens']).toBe(100);
    expect(span.events).toHaveLength(2);
  });

  it('drops malformed spans without throwing', () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                { traceId: 't', spanId: 's', name: 'x' }, // missing required attrs
              ],
            },
          ],
        },
      ],
    };
    const spans = extractSpans(payload);
    expect(spans).toHaveLength(0);
  });

  it('returns [] for empty payload', () => {
    expect(extractSpans({ resourceSpans: [] })).toHaveLength(0);
  });
});
