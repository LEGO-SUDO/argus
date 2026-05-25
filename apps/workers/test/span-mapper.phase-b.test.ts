// Phase B span-mapper unit tests (Tasks 21/23/25). Kept separate from the
// Phase A span-mapper.test.ts.
//
// Covers: llm.kind propagation for known values, default-to-chat on missing,
// unknown-bucket + logger.warn on unrecognized values, and the three Phase B
// FK attributes propagating onto the verdict.
import { Logger } from '@nestjs/common';
import {
  OTEL_ATTRS,
  LLM_KIND,
  LLM_SAMPLE_WORKSPACE_ID,
  LLM_REPLAY_OF_INFERENCE_ID,
  LLM_CLASSIFIER_FOR_MESSAGE_ID,
  SPAN_EVENT_NAMES,
  type OtlpSpan,
} from '@argus/contracts';
import { mapSpanToProjection } from '../src/projection/span-mapper';

function makeSpan(phaseB: Record<string, unknown> = {}): OtlpSpan {
  const startMs = 1_700_000_000_000;
  return {
    traceId: 'trace-abc',
    spanId: 'span-xyz',
    name: 'llm.chat.stream',
    startTimeUnixNano: String(startMs * 1_000_000),
    endTimeUnixNano: String((startMs + 500) * 1_000_000),
    attributes: {
      [OTEL_ATTRS.LLM_PROVIDER]: 'openai',
      [OTEL_ATTRS.LLM_MODEL]: 'gpt-4o-mini',
      [OTEL_ATTRS.LLM_STATUS]: 'ok',
      [OTEL_ATTRS.CONVERSATION_ID]: '11111111-1111-1111-1111-111111111111',
      [OTEL_ATTRS.USER_ID]: '22222222-2222-2222-2222-222222222222',
      [OTEL_ATTRS.MESSAGE_ID]: '33333333-3333-3333-3333-333333333333',
      [OTEL_ATTRS.TURN_INDEX]: 0,
      ...phaseB,
    } as unknown as OtlpSpan['attributes'],
    events: [{ name: SPAN_EVENT_NAMES.LLM_INPUT, body: {} }],
  };
}

describe('span-mapper Phase B', () => {
  afterEach(() => jest.restoreAllMocks());

  // --- Task 21: propagate llm.kind for known values ---
  it('propagates llm.kind onto the inference verdict for known values', () => {
    expect(mapSpanToProjection(makeSpan({ [LLM_KIND]: 'classifier' })).inference.kind).toBe(
      'classifier',
    );
    expect(mapSpanToProjection(makeSpan({ [LLM_KIND]: 'replay' })).inference.kind).toBe('replay');
    expect(mapSpanToProjection(makeSpan({ [LLM_KIND]: 'sample' })).inference.kind).toBe('sample');
    expect(mapSpanToProjection(makeSpan({ [LLM_KIND]: 'heartbeat' })).inference.kind).toBe(
      'heartbeat',
    );
  });

  // --- Task 23/24: missing -> chat (no warn); unrecognized -> unknown + warn ---
  it('defaults missing kind to chat without warning', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(mapSpanToProjection(makeSpan()).inference.kind).toBe('chat');
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes an unrecognized kind value to unknown and logs a warn carrying the value', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const verdict = mapSpanToProjection(makeSpan({ [LLM_KIND]: 'future-kind-xyz' })).inference;
    expect(verdict.kind).toBe('unknown');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('future-kind-xyz');
  });

  it('treats a literal "unknown" incoming value as unrecognized (warns, kind=unknown)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const verdict = mapSpanToProjection(makeSpan({ [LLM_KIND]: 'unknown' })).inference;
    expect(verdict.kind).toBe('unknown');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // --- Task 25/26: three FK attributes propagate; absent -> null ---
  it('propagates the three Phase B FK attributes onto the inference verdict', () => {
    const classifierFor = '44444444-4444-4444-4444-444444444444';
    const replayOf = '55555555-5555-5555-5555-555555555555';
    const sampleWs = '66666666-6666-6666-6666-666666666666';

    const classifier = mapSpanToProjection(
      makeSpan({ [LLM_KIND]: 'classifier', [LLM_CLASSIFIER_FOR_MESSAGE_ID]: classifierFor }),
    ).inference;
    expect(classifier.classifierForMessageId).toBe(classifierFor);

    const replay = mapSpanToProjection(
      makeSpan({ [LLM_KIND]: 'replay', [LLM_REPLAY_OF_INFERENCE_ID]: replayOf }),
    ).inference;
    expect(replay.replayOfInferenceId).toBe(replayOf);

    const sample = mapSpanToProjection(
      makeSpan({ [LLM_KIND]: 'sample', [LLM_SAMPLE_WORKSPACE_ID]: sampleWs }),
    ).inference;
    expect(sample.sampleWorkspaceId).toBe(sampleWs);
  });

  it('leaves the FK fields null when their attributes are absent', () => {
    const verdict = mapSpanToProjection(makeSpan()).inference;
    expect(verdict.classifierForMessageId).toBeNull();
    expect(verdict.replayOfInferenceId).toBeNull();
    expect(verdict.sampleWorkspaceId).toBeNull();
  });
});
