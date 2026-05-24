// Tests for ConsoleLiveProvider + useConsoleLive (LLD Tasks 62, 64, 66, 68).
//
// We inject a fake SSE client (matching the SseClient surface the provider
// uses) so we can drive ticks + errors deterministically without a real
// EventSource.
import { createElement, useEffect } from 'react';
import { render, act, screen } from '@testing-library/react';

import { ConsoleLiveProvider } from '@/components/console/ConsoleLiveProvider';
import {
  useConsoleLive,
  type LiveTickListener,
  type LiveTickPredicate,
} from '@/lib/use-console-live';
import type { SseClient } from '@/lib/sse-client';
import type { LiveEvent } from '@argus/contracts';

const USER = '11111111-1111-4111-8111-111111111111';
const CONV = '22222222-2222-4222-8222-222222222222';
const tick = (kind: LiveEvent['kind']): LiveEvent => ({
  type: 'tick',
  user_id: USER,
  kind,
  conversation_id: CONV,
});

class FakeSseClient {
  private eventHandler: ((e: LiveEvent) => void) | null = null;
  private errorHandler: ((e: unknown) => void) | null = null;
  closeCount = 0;
  onEvent(h: (e: LiveEvent) => void) {
    this.eventHandler = h;
  }
  onError(h: (e: unknown) => void) {
    this.errorHandler = h;
  }
  onOpen() {}
  close() {
    this.closeCount += 1;
  }
  emit(e: LiveEvent) {
    this.eventHandler?.(e);
  }
  emitError(e: unknown) {
    this.errorHandler?.(e);
  }
}

function LatestTickProbe() {
  const { latestTick } = useConsoleLive();
  return createElement('div', { 'data-testid': 'latest' }, latestTick?.kind ?? 'none');
}

function SubscribeProbe({
  predicate,
  listener,
}: {
  predicate: LiveTickPredicate;
  listener: LiveTickListener;
}) {
  const { subscribe } = useConsoleLive();
  useEffect(() => subscribe(predicate, listener), [subscribe, predicate, listener]);
  return null;
}

describe('useConsoleLive latestTick (Task 62)', () => {
  it('reflects a tick the SSE client receives', () => {
    const fake = new FakeSseClient();
    render(
      createElement(
        ConsoleLiveProvider,
        { client: fake as unknown as SseClient },
        createElement(LatestTickProbe),
      ),
    );
    expect(screen.getByTestId('latest')).toHaveTextContent('none');
    act(() => fake.emit(tick('chat')));
    expect(screen.getByTestId('latest')).toHaveTextContent('chat');
  });

  it('throws when used outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(createElement(LatestTickProbe))).toThrow(/ConsoleLiveProvider/);
    spy.mockRestore();
  });
});

describe('useConsoleLive.subscribe predicate filtering (Task 64)', () => {
  it('only fires the listener for matching events', () => {
    const fake = new FakeSseClient();
    const listener = jest.fn();
    render(
      createElement(
        ConsoleLiveProvider,
        { client: fake as unknown as SseClient },
        createElement(SubscribeProbe, {
          predicate: (e: LiveEvent) => e.kind === 'chat',
          listener,
        }),
      ),
    );
    act(() => fake.emit(tick('classifier')));
    expect(listener).not.toHaveBeenCalled();
    act(() => fake.emit(tick('chat')));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]).toMatchObject({ kind: 'chat' });
  });
});

describe('ConsoleLiveProvider unmount (Task 66)', () => {
  it('closes the SSE client exactly once', () => {
    const fake = new FakeSseClient();
    const { unmount } = render(
      createElement(ConsoleLiveProvider, { client: fake as unknown as SseClient }, null),
    );
    unmount();
    expect(fake.closeCount).toBe(1);
  });
});

describe('ConsoleLiveProvider error isolation (Task 68)', () => {
  it('does not advance latestTick when the SSE client surfaces an error', () => {
    const fake = new FakeSseClient();
    render(
      createElement(
        ConsoleLiveProvider,
        { client: fake as unknown as SseClient },
        createElement(LatestTickProbe),
      ),
    );
    act(() => fake.emitError({ reason: 'validation', message: 'bad' }));
    expect(screen.getByTestId('latest')).toHaveTextContent('none');
    // A valid tick after the error still advances normally.
    act(() => fake.emit(tick('replay')));
    expect(screen.getByTestId('latest')).toHaveTextContent('replay');
  });
});
