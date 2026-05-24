// Cross-pane contract round-trip — live-events (web pane owns this file).
//
// LLD frontend-web Task 1A/1B: the web console consumes `LiveEventSchema`
// (the SSE tick it refetches on) and `LiveEventKindEnum`. This file verifies
// the CLIENT-consumable shapes round-trip; the backend-api pane authors the
// schemas and the infra pane owns the snake_case wire assertion in sse.test.ts.
//
// NOTE (contract reconciliation): the LLD prose references a `heartbeat`
// LiveEvent variant, but the authored `LiveEventSchema` is a discriminated
// union with only the `tick` variant — the live badge is a REST poll of
// `/console/live/badge` (BadgeLagResponseSchema), not reconstructed from a
// heartbeat SSE event. So only the `tick` variant is exercised here.
import {
  LiveEventSchema,
  LiveTickEventSchema,
  LiveEventKindEnum,
  LiveEventsPayload,
  type LiveEvent,
  type InferenceKind,
} from '@argus/contracts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

describe('LiveEventKindEnum', () => {
  it('accepts every documented inference kind', () => {
    for (const kind of [
      'chat',
      'classifier',
      'replay',
      'sample',
      'heartbeat',
      'unknown',
    ] as const) {
      const parsed: InferenceKind = LiveEventKindEnum.parse(kind);
      expect(parsed).toBe(kind);
    }
  });

  it('rejects an unrecognized kind', () => {
    expect(LiveEventKindEnum.safeParse('not-a-kind').success).toBe(false);
  });
});

describe('LiveEventSchema (tick variant)', () => {
  it('round-trips a well-formed tick event', () => {
    const tick = {
      type: 'tick' as const,
      user_id: USER_ID,
      kind: 'chat' as const,
      conversation_id: CONVERSATION_ID,
    };
    const parsed: LiveEvent = LiveEventSchema.parse(tick);
    expect(parsed).toEqual(tick);
    // The discriminator narrows to the tick variant.
    expect(parsed.type).toBe('tick');
  });

  it('rejects a tick missing the required conversation_id field', () => {
    const result = LiveEventSchema.safeParse({
      type: 'tick',
      user_id: USER_ID,
      kind: 'chat',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tick whose ids are not uuids', () => {
    expect(
      LiveTickEventSchema.safeParse({
        type: 'tick',
        user_id: 'not-a-uuid',
        kind: 'chat',
        conversation_id: CONVERSATION_ID,
      }).success,
    ).toBe(false);
  });
});

describe('LiveEventsPayload (Kafka wire value — snake_case)', () => {
  it('round-trips the snake_case payload the workers pane publishes', () => {
    const payload = {
      user_id: USER_ID,
      kind: 'replay' as const,
      conversation_id: CONVERSATION_ID,
    };
    expect(LiveEventsPayload.parse(payload)).toEqual(payload);
  });

  it('rejects a payload missing kind', () => {
    expect(
      LiveEventsPayload.safeParse({
        user_id: USER_ID,
        conversation_id: CONVERSATION_ID,
      }).success,
    ).toBe(false);
  });
});

describe('export presence (LLD Task 1B sanity)', () => {
  it('exposes every live-events export the console consumes', () => {
    expect(LiveEventSchema).toBeDefined();
    expect(LiveTickEventSchema).toBeDefined();
    expect(LiveEventKindEnum).toBeDefined();
    expect(LiveEventsPayload).toBeDefined();
  });
});
