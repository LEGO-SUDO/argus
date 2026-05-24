import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { startLlmSpan } from '../otel';
import { OTEL_ATTRS, SPAN_EVENT_NAMES } from '@argus/contracts';
import type { ChatStreamRequest } from '../index';

const CONV_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const MSG_ID = '00000000-0000-0000-0000-000000000003';

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;

beforeAll(() => {
  // OTel SDK v2: span processors are passed to the constructor (no
  // addSpanProcessor on the prototype).
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
});

function makeReq(): ChatStreamRequest {
  return {
    conversationId: CONV_ID,
    userId: USER_ID,
    messageId: MSG_ID,
    turnIndex: 0,
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ],
  };
}

function getSpan(): ReadableSpan {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  const s = spans[0];
  if (!s) throw new Error('no span exported');
  return s;
}

describe('startLlmSpan lifecycle', () => {
  it('seeds request attributes and emits llm.input event on start', () => {
    const span = startLlmSpan(makeReq());
    span.succeed({ provider: 'openai', model: 'gpt-4o-mini', promptTokens: 1, completionTokens: 2 }, 'out');
    const s = getSpan();
    expect(s.name).toBe('llm.chat');
    expect(s.attributes[OTEL_ATTRS.CONVERSATION_ID]).toBe(CONV_ID);
    expect(s.attributes[OTEL_ATTRS.USER_ID]).toBe(USER_ID);
    expect(s.attributes[OTEL_ATTRS.MESSAGE_ID]).toBe(MSG_ID);
    expect(s.attributes[OTEL_ATTRS.TURN_INDEX]).toBe(0);
    const inputEvent = s.events.find((e) => e.name === SPAN_EVENT_NAMES.LLM_INPUT);
    expect(inputEvent).toBeDefined();
    expect(typeof inputEvent?.attributes?.['body']).toBe('string');
  });

  it('succeed() attaches provider attrs + cost and ends OK', () => {
    const span = startLlmSpan(makeReq());
    span.succeed(
      { provider: 'openai', model: 'gpt-4o-mini', promptTokens: 1_000_000, completionTokens: 1_000_000 },
      'final output',
    );
    const s = getSpan();
    expect(s.attributes[OTEL_ATTRS.LLM_PROVIDER]).toBe('openai');
    expect(s.attributes[OTEL_ATTRS.LLM_MODEL]).toBe('gpt-4o-mini');
    expect(s.attributes[OTEL_ATTRS.LLM_PROMPT_TOKENS]).toBe(1_000_000);
    expect(s.attributes[OTEL_ATTRS.LLM_COMPLETION_TOKENS]).toBe(1_000_000);
    expect(s.attributes[OTEL_ATTRS.LLM_STATUS]).toBe('ok');
    // gpt-4o-mini at $0.15 / $0.6 per 1M tokens:
    expect(s.attributes[OTEL_ATTRS.LLM_PROMPT_COST_USD_MICROS]).toBe(150_000);
    expect(s.attributes[OTEL_ATTRS.LLM_COMPLETION_COST_USD_MICROS]).toBe(600_000);
    expect(s.status.code).toBe(SpanStatusCode.OK);
    const outputEvent = s.events.find((e) => e.name === SPAN_EVENT_NAMES.LLM_OUTPUT);
    expect(outputEvent?.attributes?.['body']).toBe('final output');
  });

  it('cancel() marks status=canceled and ends OK', () => {
    const span = startLlmSpan(makeReq());
    span.cancel('openai', 'gpt-4o-mini', 'partial');
    const s = getSpan();
    expect(s.attributes[OTEL_ATTRS.LLM_STATUS]).toBe('canceled');
    expect(s.attributes[OTEL_ATTRS.LLM_PROVIDER]).toBe('openai');
    expect(s.status.code).toBe(SpanStatusCode.OK);
  });

  it('fail() marks status=failed, attaches error code, records exception', () => {
    const span = startLlmSpan(makeReq());
    span.fail('anthropic', 'claude-3-5-haiku-latest', 'auth_failed', new Error('bad key'), 'nothing');
    const s = getSpan();
    expect(s.attributes[OTEL_ATTRS.LLM_STATUS]).toBe('failed');
    expect(s.attributes[OTEL_ATTRS.LLM_ERROR_CODE]).toBe('auth_failed');
    expect(s.status.code).toBe(SpanStatusCode.ERROR);
    const exceptionEvent = s.events.find((e) => e.name === 'exception');
    expect(exceptionEvent).toBeDefined();
  });

  it('terminal handlers are idempotent — calling succeed twice produces one span', () => {
    const span = startLlmSpan(makeReq());
    span.succeed({ provider: 'mock', model: 'mock-1' }, 'a');
    span.succeed({ provider: 'mock', model: 'mock-1' }, 'b'); // no-op
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('caps over-size body events to 100KB and marks truncated', () => {
    const span = startLlmSpan(makeReq());
    const big = 'x'.repeat(200 * 1024);
    span.succeed({ provider: 'mock', model: 'mock-1' }, big);
    const s = getSpan();
    const outputEvent = s.events.find((e) => e.name === SPAN_EVENT_NAMES.LLM_OUTPUT);
    expect(outputEvent?.attributes?.['truncated']).toBe(true);
    const body = outputEvent?.attributes?.['body'] as string;
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(100 * 1024);
  });
});
