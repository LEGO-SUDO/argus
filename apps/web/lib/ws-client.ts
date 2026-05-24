// ws-client — typed WebSocket wrapper for the chat surface.
//
// LLD Tasks 25-32. Wraps the browser WebSocket so the chat UI never sees
// raw `message` events or string payloads. Every inbound frame is parsed
// and validated against the discriminated union from `@argus/contracts`;
// invalid frames go to `onError` with a structured reason so the UI can
// surface them without guessing.
//
// Cookies travel implicitly via same-origin browser rules (the WS handshake
// reuses the session cookie set by the REST login). There's nothing to
// configure on the client; the test for Task 25 verifies the URL is what
// gets passed to the constructor.

import {
  WsFrameOutboundSchema,
  type WsFrameInbound,
  type WsFrameOutbound,
} from '@argus/contracts';

/**
 * WebSocket.OPEN === 1 per the WHATWG spec. We capture it locally so the
 * production code does not depend on `globalThis.WebSocket.OPEN` being
 * present (test stubs can omit class statics).
 */
const READYSTATE_OPEN = 1;

export type WsClientErrorReason =
  /** JSON.parse failed. */
  | 'parse'
  /** Frame failed zod validation against the outbound schema. */
  | 'validation'
  /** Underlying socket error event. */
  | 'socket'
  /** Socket closed unexpectedly. */
  | 'close';

export type WsClientError = {
  reason: WsClientErrorReason;
  message: string;
  /** Raw payload that triggered the error, if available. */
  raw?: unknown;
};

export type FrameHandler = (frame: WsFrameOutbound) => void;
export type ErrorHandler = (err: WsClientError) => void;
export type CloseHandler = (code: number, reason: string) => void;
export type OpenHandler = () => void;

/**
 * Resolve the WS URL from env at module evaluation time. The default points
 * at the local apps/api gateway path; production deployments override via
 * `NEXT_PUBLIC_WS_URL`.
 *
 * Public so callers can opt out (e.g. tests pass their own URL).
 */
export function defaultWsUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }
  // Fallback for SSR / dev — apps/api WS gateway is mounted at /ws/chat.
  return 'ws://localhost:4000/ws/chat';
}

export class WsClient {
  private readonly socket: WebSocket;
  private frameHandler: FrameHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private openHandler: OpenHandler | null = null;
  private closed = false;
  private opened = false;
  /**
   * Errors that fire before the consumer has had a chance to register an
   * `onError` handler get buffered here and replayed when the handler is
   * eventually attached. Without this, the WS handshake can race the
   * useEffect that wires up the handlers, and the user never sees the
   * "websocket error" surface. We only buffer the FIRST error — once the
   * consumer is attached, errors flow through synchronously.
   */
  private bufferedError: WsClientError | null = null;
  /** Same buffering rationale for the open event. */
  private openBuffered = false;

  constructor(url: string = defaultWsUrl()) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    this.socket.onopen = () => {
      this.opened = true;
      if (this.openHandler) {
        this.openHandler();
      } else {
        this.openBuffered = true;
      }
    };
    this.socket.onerror = (ev: Event) => {
      const err: WsClientError = {
        reason: 'socket',
        message: 'websocket error',
        raw: ev,
      };
      if (this.errorHandler) {
        this.errorHandler(err);
      } else if (!this.bufferedError) {
        this.bufferedError = err;
      }
    };
    this.socket.onclose = (ev: CloseEvent) => {
      // Mark closed first so any late handlers see the suppressed state.
      this.closed = true;
      this.closeHandler?.(ev.code, ev.reason);
    };
  }

  // -------------------------------------------------------------------------
  // Subscribers — single-handler model. The component owns its WS instance
  // for its lifetime; multiplexing is not a requirement (one stream per chat
  // surface). Calling `onFrame` twice replaces the prior handler — explicit.
  // -------------------------------------------------------------------------

  onFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
    // Replay any pre-registration error so the consumer can surface it.
    if (this.bufferedError) {
      const buffered = this.bufferedError;
      this.bufferedError = null;
      handler(buffered);
    }
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  onOpen(handler: OpenHandler): void {
    this.openHandler = handler;
    // If the socket already opened before the consumer wired up the
    // handler (race with the WS handshake completing during the same tick
    // as `new WsClient()`), fire it immediately so the UI flips to ready.
    if (this.openBuffered) {
      this.openBuffered = false;
      handler();
    }
  }

  // -------------------------------------------------------------------------
  // Send + close.
  // -------------------------------------------------------------------------

  send(frame: WsFrameInbound): void {
    if (this.closed) {
      throw new Error('ws-client: not connected (closed)');
    }
    // WebSocket.OPEN === 1 per the WHATWG spec. We compare against the
    // instance's own readyState rather than referencing the global static
    // so test stubs aren't forced to mirror the class-level constants.
    if (this.socket.readyState !== READYSTATE_OPEN) {
      throw new Error('ws-client: not connected');
    }
    this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    // Calling .close() on a CONNECTING socket triggers a browser console
    // warning: 'WebSocket is closed before the connection is established'.
    // This fires legitimately when React remounts the component mid-
    // handshake (Next 15 + React 19 page-reconcile races, dev StrictMode
    // double-invoke). Defer the actual close until OPEN so the socket
    // shuts down cleanly without the noise.
    if (this.socket.readyState === 0 /* CONNECTING */) {
      const closeWhenOpen = () => {
        try {
          this.socket.close();
        } catch {
          /* already closing — safe */
        }
      };
      this.socket.addEventListener('open', closeWhenOpen, { once: true });
      // If the handshake fails entirely, the WebSocket fires `error` then
      // `close` on its own — nothing for us to do.
      return;
    }
    try {
      this.socket.close();
    } catch {
      // Already closing — safe to ignore.
    }
  }

  /** True iff the socket has reached OPEN at least once. */
  isOpen(): boolean {
    return this.opened && !this.closed;
  }

  // -------------------------------------------------------------------------
  // Inbound message handling.
  // -------------------------------------------------------------------------

  private handleMessage(ev: MessageEvent): void {
    // After close() the user explicitly opted out — drop everything.
    if (this.closed) {
      return;
    }
    const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.errorHandler?.({
        reason: 'parse',
        message: (err as Error).message,
        raw,
      });
      return;
    }
    const result = WsFrameOutboundSchema.safeParse(parsed);
    if (!result.success) {
      this.errorHandler?.({
        reason: 'validation',
        message: result.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; '),
        raw: parsed,
      });
      return;
    }
    this.frameHandler?.(result.data);
  }
}
