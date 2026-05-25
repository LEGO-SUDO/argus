// Task 32: LiveEventsPublisher unit tests (mocked kafkajs producer).
//
// Covers: (i) publish -> producer.send with topic, key=user_id, snake_case
// value parseable by LiveEventsPayload; (ii) send rejection is captured
// (recoverable=yes) and swallowed (never re-thrown); (iii) connect on
// onModuleInit, disconnect on onModuleDestroy.
import type { Kafka } from 'kafkajs';
import { LiveEventsPayload } from '@argus/contracts';

// Mock the sentry helper so we can assert the swallow-and-capture behavior.
jest.mock('../src/observability/sentry', () => ({
  captureProjectionError: jest.fn(),
}));
import { captureProjectionError } from '../src/observability/sentry';
import { LiveEventsPublisher } from '../src/projection/live-events-publisher';

function makeMockKafka() {
  const send = jest.fn().mockResolvedValue(undefined);
  const connect = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const producer = { send, connect, disconnect };
  const kafka = { producer: jest.fn().mockReturnValue(producer) } as unknown as Kafka;
  return { kafka, producer, send, connect, disconnect };
}

const PAYLOAD = {
  user_id: '11111111-1111-1111-1111-111111111111',
  kind: 'chat' as const,
  conversation_id: '22222222-2222-2222-2222-222222222222',
};

describe('LiveEventsPublisher', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes to live-events keyed by user_id with a snake_case payload', async () => {
    const { kafka, send } = makeMockKafka();
    const publisher = new LiveEventsPublisher(kafka);

    await publisher.publish(PAYLOAD);

    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0] as {
      topic: string;
      messages: Array<{ key: string; value: string }>;
    };
    expect(arg.topic).toBe('live-events');
    const msg = arg.messages[0]!;
    expect(msg.key).toBe(PAYLOAD.user_id);
    const parsed = LiveEventsPayload.parse(JSON.parse(msg.value));
    expect(parsed).toEqual(PAYLOAD);
    // Snake_case field names hold on the wire.
    const wire = JSON.parse(msg.value) as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(['conversation_id', 'kind', 'user_id']);
  });

  it('swallows a producer.send rejection and captures it recoverable=yes', async () => {
    const { kafka, send } = makeMockKafka();
    send.mockRejectedValueOnce(new Error('kafka unavailable'));
    const publisher = new LiveEventsPublisher(kafka);

    await expect(publisher.publish(PAYLOAD)).resolves.toBeUndefined();
    expect(captureProjectionError).toHaveBeenCalledTimes(1);
    expect(captureProjectionError).toHaveBeenCalledWith(
      expect.objectContaining({ recoverable: 'yes' }),
    );
  });

  it('connects on onModuleInit and disconnects on onModuleDestroy', async () => {
    const { kafka, connect, disconnect } = makeMockKafka();
    const publisher = new LiveEventsPublisher(kafka);

    await publisher.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);

    await publisher.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
