// Tests for the typed WebSocket client (LLD Tasks 25, 27, 29, 31).
//
// We stub the global WebSocket constructor so the tests run in jsdom without
// opening a real socket. The stub records every call (URL passed to ctor,
// send calls, close calls) and exposes hooks to fire `message`/`error` events.

import { WsClient } from '@/lib/ws-client';

// WebSocket readyState constants per the WHATWG spec.
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

type MessageHandler = (ev: MessageEvent) => void;
type CloseHandler = (ev: CloseEvent) => void;
type ErrorHandler = (ev: Event) => void;
type OpenHandler = (ev: Event) => void;

class StubWebSocket {
  static instances: StubWebSocket[] = [];
  static lastUrl: string | null = null;

  readonly url: string;
  readyState: number = CONNECTING;
  sent: string[] = [];
  closed = false;
  onmessage: MessageHandler | null = null;
  onclose: CloseHandler | null = null;
  onerror: ErrorHandler | null = null;
  onopen: OpenHandler | null = null;
  // Tracks `addEventListener('open', ...)` registrations. WsClient.close
  // uses this path when called against a CONNECTING socket to defer the
  // actual close until OPEN (avoids the 'closed before established'
  // browser warning).
  private openListeners: Array<EventListener> = [];

  constructor(url: string) {
    this.url = url;
    StubWebSocket.instances.push(this);
    StubWebSocket.lastUrl = url;
  }

  send(data: string): void {
    if (this.readyState !== OPEN) {
      throw new Error('not open');
    }
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }

  // Whatwg WebSocket exposes `addEventListener`; WsClient's deferred-close
  // path uses it (with `{ once: true }`). We only need 'open' support
  // today — extend if a future test needs another event.
  addEventListener(type: string, listener: EventListener, _opts?: AddEventListenerOptions): void {
    if (type === 'open') {
      this.openListeners.push(listener);
    }
  }

  // Test helpers.
  open(): void {
    this.readyState = OPEN;
    const ev = new Event('open');
    this.onopen?.(ev);
    // Flush any `addEventListener('open', …)` registrations made via
    // the WsClient deferred-close path. Each runs once (the WsClient
    // passes { once: true }) — emulating that semantic is unnecessary
    // for the tests we have today because they don't reopen after
    // closing, but we drain the queue here regardless.
    const listeners = this.openListeners.splice(0);
    for (const l of listeners) {
      l(ev);
    }
  }

  fireMessage(data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent('message', { data: payload }));
  }
}

beforeEach(() => {
  StubWebSocket.instances = [];
  StubWebSocket.lastUrl = null;
  // Override the global WebSocket constructor for the duration of the test.
  Object.defineProperty(globalThis, 'WebSocket', {
    value: StubWebSocket,
    configurable: true,
    writable: true,
  });
});

const VALID_START = {
  type: 'start',
  messageId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  provider: 'mock',
  model: 'mock-1',
  seq: 0,
};

describe('WsClient construction', () => {
  it('opens a WebSocket with the configured URL', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    expect(StubWebSocket.lastUrl).toBe('ws://localhost:4000/ws/chat');
    expect(StubWebSocket.instances).toHaveLength(1);
    client.close();
  });
});

describe('WsClient frame validation + dispatch', () => {
  it('routes valid frames to onFrame', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onFrame = jest.fn();
    const onError = jest.fn();
    client.onFrame(onFrame);
    client.onError(onError);
    StubWebSocket.instances[0]!.open();
    StubWebSocket.instances[0]!.fireMessage(VALID_START);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]![0]).toMatchObject({ type: 'start' });
    expect(onError).not.toHaveBeenCalled();
    client.close();
  });

  it('routes malformed frames to onError and not onFrame', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onFrame = jest.fn();
    const onError = jest.fn();
    client.onFrame(onFrame);
    client.onError(onError);
    StubWebSocket.instances[0]!.open();
    // Missing required `messageId` etc.
    StubWebSocket.instances[0]!.fireMessage({ type: 'start' });
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ reason: 'validation' });
    client.close();
  });

  it('routes non-JSON payloads to onError with reason=parse', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onFrame = jest.fn();
    const onError = jest.fn();
    client.onFrame(onFrame);
    client.onError(onError);
    StubWebSocket.instances[0]!.open();
    // Fire a raw string that isn't JSON.
    StubWebSocket.instances[0]!.onmessage?.(
      new MessageEvent('message', { data: 'not-json {{' }),
    );
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ reason: 'parse' });
    client.close();
  });
});

describe('WsClient.send', () => {
  it('serializes the frame to JSON when the socket is OPEN', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    StubWebSocket.instances[0]!.open();
    client.send({
      type: 'cancel',
      messageId: '11111111-1111-4111-8111-111111111111',
    });
    expect(StubWebSocket.instances[0]!.sent).toHaveLength(1);
    expect(JSON.parse(StubWebSocket.instances[0]!.sent[0]!)).toMatchObject({
      type: 'cancel',
      messageId: '11111111-1111-4111-8111-111111111111',
    });
    client.close();
  });

  it('throws when called before the socket reaches OPEN', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    // Still CONNECTING — send must reject.
    expect(() =>
      client.send({
        type: 'cancel',
        messageId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow(/not connected/i);
    client.close();
  });
});

describe('WsClient.close', () => {
  it('closes the underlying socket and stops firing onFrame', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onFrame = jest.fn();
    client.onFrame(onFrame);
    const stub = StubWebSocket.instances[0]!;
    stub.open();
    client.close();
    expect(stub.closed).toBe(true);
    // Any message after close must NOT invoke handlers.
    stub.fireMessage(VALID_START);
    expect(onFrame).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pre-registration buffering — guards a race where the WS fires `error` or
// `open` synchronously during construction (or before the consumer's
// useEffect has wired up its handlers). Without buffering, the very first
// websocket error or open event was silently dropped on the floor.
// ---------------------------------------------------------------------------

describe('WsClient onError buffering', () => {
  it('replays a pre-registration socket error when onError is attached later', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const stub = StubWebSocket.instances[0]!;
    // Fire `error` BEFORE the consumer registers their handler.
    stub.onerror?.(new Event('error'));
    const onError = jest.fn();
    client.onError(onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ reason: 'socket' });
    client.close();
  });

  it('passes errors through synchronously once the handler is attached', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onError = jest.fn();
    client.onError(onError);
    const stub = StubWebSocket.instances[0]!;
    stub.onerror?.(new Event('error'));
    expect(onError).toHaveBeenCalledTimes(1);
    client.close();
  });
});

describe('WsClient onOpen', () => {
  it('fires onOpen after the socket reaches OPEN', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    const onOpen = jest.fn();
    client.onOpen(onOpen);
    StubWebSocket.instances[0]!.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(client.isOpen()).toBe(true);
    client.close();
  });

  it('fires immediately if the socket opened before onOpen was attached', () => {
    const client = new WsClient('ws://localhost:4000/ws/chat');
    StubWebSocket.instances[0]!.open();
    const onOpen = jest.fn();
    client.onOpen(onOpen);
    expect(onOpen).toHaveBeenCalledTimes(1);
    client.close();
  });
});

// Suppress unused-var lint for the unused CLOSING constant; it's kept for
// readability when tracing test scenarios.
void CLOSING;
