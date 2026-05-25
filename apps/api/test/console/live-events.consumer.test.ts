import { randomUUID } from 'crypto';
import { LiveEventsConsumer } from '../../src/console/live-events.consumer';
import { SseHub } from '../../src/console/sse-hub';
import type { ApiConfig } from '../../src/common/config';
import * as sentry from '../../src/observability/sentry';

const config = { liveEventsTopic: 'live-events', liveEventsConsumerGroup: 'api-live-fanout', sseDebounceMs: 100 } as ApiConfig;

function build(): { consumer: LiveEventsConsumer; publish: jest.Mock } {
  const publish = jest.fn();
  const hub = { publish } as unknown as SseHub;
  return { consumer: new LiveEventsConsumer(config, hub), publish };
}

describe('LiveEventsConsumer.handleMessage', () => {
  it('routes a valid payload to SseHub.publish with the decoded userId + tick', () => {
    const { consumer, publish } = build();
    const userId = randomUUID();
    const conversationId = randomUUID();
    consumer.handleMessage(JSON.stringify({ user_id: userId, kind: 'chat', conversation_id: conversationId }));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(userId, {
      type: 'tick',
      user_id: userId,
      kind: 'chat',
      conversation_id: conversationId,
    });
  });

  it('skips a malformed payload (captures + no publish) and keeps processing', () => {
    const spy = jest.spyOn(sentry, 'captureApiError').mockImplementation(() => undefined);
    const { consumer, publish } = build();
    consumer.handleMessage('not json at all');
    consumer.handleMessage(JSON.stringify({ user_id: 'not-a-uuid', kind: 'chat' })); // schema fail
    expect(publish).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ feature: 'live', layer: 'service' }));

    // A subsequent good message still flows.
    const userId = randomUUID();
    consumer.handleMessage(JSON.stringify({ user_id: userId, kind: 'replay', conversation_id: randomUUID() }));
    expect(publish).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
