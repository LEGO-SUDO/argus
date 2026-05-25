// Tests for the typed SSE client (LLD frontend-web Tasks 2-14).
//
// jsdom has no EventSource, so we stub the global constructor (mirroring the
// StubWebSocket pattern in ws-client.test.ts). The stub records the URL + init
// dict passed to the ctor and exposes helpers to fire open/message/error.
import { SseClient, defaultSseUrl } from '@/lib/sse-client';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

type Listener = (ev: Event) => void;

class StubEventSource {
  static instances: StubEventSource[] = [];
  static lastUrl: string | null = null;
  static lastInit: EventSourceInit | undefined;

  readonly url: string;
  readonly init?: EventSourceInit;
  readyState = CONNECTING;
  closeCount = 0;
  onopen: Listener | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: Listener | null = null;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    StubEventSource.instances.push(this);
    StubEventSource.lastUrl = url;
    StubEventSource.lastInit = init;
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = CLOSED;
  }

  // -- test helpers -------------------------------------------------------
  open(): void {
    this.readyState = OPEN;
    this.onopen?.(new Event('open'));
  }

  message(data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent('message', { data: payload }));
  }

  error(readyState = CONNECTING): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

beforeEach(() => {
  StubEventSource.instances = [];
  StubEventSource.lastUrl = null;
  StubEventSource.lastInit = undefined;
  Object.defineProperty(globalThis, 'EventSource', {
    value: StubEventSource,
    configurable: true,
    writable: true,
  });
});

const TICK = {
  type: 'tick',
  user_id: '11111111-1111-4111-8111-111111111111',
  kind: 'chat',
  conversation_id: '22222222-2222-4222-8222-222222222222',
};

describe('SseClient construction (Task 2)', () => {
  it('opens an EventSource to the configured URL with credentials forwarded', () => {
    const client = new SseClient('/api/console/live', { withCredentials: true });
    expect(StubEventSource.lastUrl).toBe('/api/console/live');
    expect(StubEventSource.lastInit).toEqual({ withCredentials: true });
    expect(StubEventSource.instances).toHaveLength(1);
    client.close();
  });

  it('defaults to credentialed (same-origin cookie) when no flag is passed', () => {
    const client = new SseClient('/api/console/live');
    expect(StubEventSource.lastInit).toEqual({ withCredentials: true });
    client.close();
  });
});

describe('SseClient inbound validation + dispatch (Task 4)', () => {
  it('dispatches well-formed LiveEvent payloads to the event handler', () => {
    const client = new SseClient('/api/console/live');
    const onEvent = jest.fn();
    const onError = jest.fn();
    client.onEvent(onEvent);
    client.onError(onError);
    StubEventSource.instances[0]!.message(TICK);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0]).toMatchObject({ type: 'tick', kind: 'chat' });
    expect(onError).not.toHaveBeenCalled();
    client.close();
  });

  it('routes payloads missing a required field to the error handler (reason=validation)', () => {
    const client = new SseClient('/api/console/live');
    const onEvent = jest.fn();
    const onError = jest.fn();
    client.onEvent(onEvent);
    client.onError(onError);
    StubEventSource.instances[0]!.message({ type: 'tick', kind: 'chat' });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ reason: 'validation' });
    client.close();
  });
});

describe('SseClient malformed JSON (Task 6)', () => {
  it('routes non-JSON data to the error handler (reason=parse) without throwing', () => {
    const client = new SseClient('/api/console/live');
    const onEvent = jest.fn();
    const onError = jest.fn();
    client.onEvent(onEvent);
    client.onError(onError);
    expect(() =>
      StubEventSource.instances[0]!.onmessage?.(
        new MessageEvent('message', { data: 'not json {{' }),
      ),
    ).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({ reason: 'parse' });
    client.close();
  });
});

describe('SseClient transport error (Task 8)', () => {
  it('forwards transport errors with reason=transport and the readyState', () => {
    const client = new SseClient('/api/console/live');
    const onError = jest.fn();
    client.onError(onError);
    StubEventSource.instances[0]!.error(CONNECTING);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toMatchObject({
      reason: 'transport',
      readyState: CONNECTING,
    });
    client.close();
  });
});

describe('SseClient open handler (Task 10)', () => {
  it('fires the open handler exactly once when the source opens', () => {
    const client = new SseClient('/api/console/live');
    const onOpen = jest.fn();
    client.onOpen(onOpen);
    StubEventSource.instances[0]!.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    client.close();
  });

  it('fires immediately if the source opened before onOpen was attached', () => {
    const client = new SseClient('/api/console/live');
    StubEventSource.instances[0]!.open();
    const onOpen = jest.fn();
    client.onOpen(onOpen);
    expect(onOpen).toHaveBeenCalledTimes(1);
    client.close();
  });
});

describe('SseClient.close (Task 12)', () => {
  it('suppresses subsequent event + error handler invocations', () => {
    const client = new SseClient('/api/console/live');
    const onEvent = jest.fn();
    const onError = jest.fn();
    client.onEvent(onEvent);
    client.onError(onError);
    const stub = StubEventSource.instances[0]!;
    client.close();
    stub.message(TICK);
    stub.error();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('closes the underlying source exactly once even when called repeatedly', () => {
    const client = new SseClient('/api/console/live');
    const stub = StubEventSource.instances[0]!;
    client.close();
    client.close();
    client.close();
    expect(stub.closeCount).toBe(1);
  });
});

describe('defaultSseUrl (Task 14)', () => {
  const original = process.env.NEXT_PUBLIC_SSE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SSE_URL;
    else process.env.NEXT_PUBLIC_SSE_URL = original;
  });

  it('honors NEXT_PUBLIC_SSE_URL when set', () => {
    process.env.NEXT_PUBLIC_SSE_URL = 'https://sse.example.com/console/live';
    expect(defaultSseUrl()).toBe('https://sse.example.com/console/live');
  });

  it('falls back to /api/console/live when unset or empty', () => {
    delete process.env.NEXT_PUBLIC_SSE_URL;
    expect(defaultSseUrl()).toBe('/api/console/live');
    process.env.NEXT_PUBLIC_SSE_URL = '';
    expect(defaultSseUrl()).toBe('/api/console/live');
  });
});

void OPEN;
