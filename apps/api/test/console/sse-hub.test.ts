import { randomUUID } from 'crypto';
import { SseHub } from '../../src/console/sse-hub';
import type { ApiConfig } from '../../src/common/config';
import type { SseTick } from '@argus/contracts';

const DEBOUNCE = 100;

function hub(): SseHub {
  return new SseHub({ sseDebounceMs: DEBOUNCE } as ApiConfig);
}

function tick(userId: string, conversationId = randomUUID()): SseTick {
  return { type: 'tick', user_id: userId, kind: 'chat', conversation_id: conversationId };
}

describe('SseHub', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('subscribe / unsubscribe lifecycle; a publish reaches all current subscribers', () => {
    const h = hub();
    const u = randomUUID();
    const a = jest.fn();
    const b = jest.fn();
    const offA = h.subscribe(u, a);
    h.subscribe(u, b);
    h.publish(u, tick(u));
    jest.advanceTimersByTime(DEBOUNCE);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    h.publish(u, tick(u));
    jest.advanceTimersByTime(DEBOUNCE);
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('routes per-user: publishing to A never reaches B', () => {
    const h = hub();
    const a = randomUUID();
    const b = randomUUID();
    const aCb = jest.fn();
    const bCb = jest.fn();
    h.subscribe(a, aCb);
    h.subscribe(b, bCb);
    h.publish(a, tick(a));
    jest.advanceTimersByTime(DEBOUNCE);
    expect(aCb).toHaveBeenCalledTimes(1);
    expect(bCb).not.toHaveBeenCalled();
  });

  it('debounce coalesces a burst into a single tick', () => {
    const h = hub();
    const u = randomUUID();
    const cb = jest.fn();
    h.subscribe(u, cb);
    for (let i = 0; i < 10; i++) {
      h.publish(u, { type: 'tick', user_id: u, kind: i % 2 === 0 ? 'chat' : 'sample', conversation_id: randomUUID() });
    }
    expect(cb).not.toHaveBeenCalled(); // nothing before the window elapses
    jest.advanceTimersByTime(DEBOUNCE);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('publishing with no subscribers is a no-op and retains nothing', () => {
    const h = hub();
    const u = randomUUID();
    h.publish(u, tick(u)); // no throw
    jest.advanceTimersByTime(DEBOUNCE);
    // A later subscriber must NOT receive the earlier tick.
    const cb = jest.fn();
    h.subscribe(u, cb);
    jest.advanceTimersByTime(DEBOUNCE);
    expect(cb).not.toHaveBeenCalled();
  });
});
