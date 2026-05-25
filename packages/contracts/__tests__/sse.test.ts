// Task 2 (contract regression guard, INFRA-owned).
//
// The `live-events` Kafka payload and the SSE tick are LOCKED to snake_case
// field names (CONTRACTS.md §Naming — matches the OTel attribute / DB column
// convention). The workers publisher constructs the payload with these exact
// keys; this test fails CI if the contracts schema ever drifts to camelCase.
import {
  LiveEventsPayload,
  LiveTickEventSchema,
  type InferenceKind,
} from '@argus/contracts';

describe('LiveEventsPayload snake_case contract', () => {
  it('exposes exactly the snake_case field names per the HLD lock', () => {
    expect(Object.keys(LiveEventsPayload.shape).sort()).toEqual([
      'conversation_id',
      'kind',
      'user_id',
    ]);
  });

  it('parses a snake_case payload and preserves the field names', () => {
    const value = {
      user_id: '11111111-1111-1111-1111-111111111111',
      kind: 'chat' as InferenceKind,
      conversation_id: '22222222-2222-2222-2222-222222222222',
    };
    const parsed = LiveEventsPayload.parse(value);
    expect(Object.keys(parsed).sort()).toEqual(['conversation_id', 'kind', 'user_id']);
    expect(parsed).toEqual(value);
  });

  it('rejects a camelCase payload (proves snake_case keys are required)', () => {
    const camel = {
      userId: '11111111-1111-1111-1111-111111111111',
      kind: 'chat',
      conversationId: '22222222-2222-2222-2222-222222222222',
    };
    expect(LiveEventsPayload.safeParse(camel).success).toBe(false);
  });

  it('the SSE tick event carries the same snake_case fields plus a tick discriminator', () => {
    expect(Object.keys(LiveTickEventSchema.shape).sort()).toEqual([
      'conversation_id',
      'kind',
      'type',
      'user_id',
    ]);
  });
});
