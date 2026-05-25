// sse-client — typed Server-Sent-Events wrapper for the `/console` live feed.
//
// LLD frontend-web Phase 1 (Tasks 2-15). Deliberately mirrors `ws-client.ts`
// in shape so reviewers see one transport idiom across the app: a thin class
// that wraps the browser primitive, validates every inbound payload against a
// `@argus/contracts` schema, and exposes single-handler registration plus a
// `close()` method.
//
// The client wraps the browser-native `EventSource`. Every inbound `message`
// event's `data` is JSON-parsed and validated against `LiveEventSchema`; valid
// events reach `onEvent`, everything else reaches `onError` with a structured
// reason so the UI can render the live-badge state without guessing.
//
// --- Notification-only semantics (HLD D3) -------------------------------
// The SSE tick is a NOTIFICATION ("something changed for this user — refetch
// your slice"), not a state-carrying event. Clients do NOT reconstruct state
// from the stream, so Last-Event-ID is intentionally NOT used to replay missed
// events: on reconnect the browser EventSource simply resumes notifications and
// any rows missed during the gap surface on the next user-triggered or live
// refetch. Do not add replay logic here.
//
// --- Reconnect ----------------------------------------------------------
// The browser EventSource reconnects automatically on transport drop. This
// wrapper does NOT duplicate that — it forwards transport `error` events to
// `onError` with `reason: 'transport'` and the source's `readyState` so the
// caller (the `useLiveBadge` hook) can decide when to surface an ingestion
// failure. Application-level reconnect / dedupe lives in the hook layer, not
// here; the SSE client is a thin event pipe.

import { LiveEventSchema, type LiveEvent } from '@argus/contracts';

/** EventSource.CONNECTING / OPEN / CLOSED per the WHATWG spec, captured
 *  locally so the code does not depend on the global static being present
 *  (test stubs can omit class statics). */
const READYSTATE_CLOSED = 2;

export type SseClientErrorReason =
  /** JSON.parse failed on the event `data`. */
  | 'parse'
  /** Payload failed zod validation against `LiveEventSchema`. */
  | 'validation'
  /** Underlying EventSource transport error (drop / reconnecting / closed). */
  | 'transport';

export type SseClientError = {
  reason: SseClientErrorReason;
  message: string;
  /** Raw payload that triggered the error, if available. */
  raw?: unknown;
  /** EventSource.readyState at the time of a transport error — lets callers
   *  distinguish reconnecting (CONNECTING) from permanently closed (CLOSED). */
  readyState?: number;
};

export type SseEventHandler = (event: LiveEvent) => void;
export type SseErrorHandler = (err: SseClientError) => void;
export type SseOpenHandler = () => void;

export type SseClientOptions = {
  /** Forward the session cookie on the SSE handshake. Defaults to true —
   *  the default URL is same-origin so the cookie attaches. Cross-origin SSE
   *  auth is out of scope for Phase B (see LLD Open Questions). */
  withCredentials?: boolean;
};

/**
 * Resolve the SSE URL from env at call time. Default is same-origin
 * `/api/console/live` (the Next rewrite proxies to the api), so the session
 * cookie attaches. Production deployments override via `NEXT_PUBLIC_SSE_URL`.
 *
 * Public so callers can opt out (tests pass their own URL).
 */
export function defaultSseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SSE_URL;
  if (envUrl && envUrl.length > 0) {
    return envUrl;
  }
  return '/api/console/live';
}

export class SseClient {
  private readonly source: EventSource;
  private eventHandler: SseEventHandler | null = null;
  private errorHandler: SseErrorHandler | null = null;
  private openHandler: SseOpenHandler | null = null;
  private closed = false;
  /** The source opened before the consumer wired up `onOpen` — replay it
   *  when the handler is eventually attached (mirrors ws-client buffering). */
  private openBuffered = false;

  constructor(url: string = defaultSseUrl(), options: SseClientOptions = {}) {
    const withCredentials = options.withCredentials ?? true;
    this.source = new EventSource(url, { withCredentials });

    this.source.onopen = () => {
      if (this.closed) return;
      if (this.openHandler) {
        this.openHandler();
      } else {
        this.openBuffered = true;
      }
    };
    this.source.onmessage = (ev: MessageEvent) => this.handleMessage(ev);
    this.source.onerror = () => {
      if (this.closed) return;
      this.errorHandler?.({
        reason: 'transport',
        message: 'sse transport error',
        readyState: this.source.readyState,
      });
    };
  }

  // -------------------------------------------------------------------------
  // Subscribers — single-handler model, matching ws-client. One stream per
  // console surface (the ConsoleLiveProvider); multiplexing is not a goal.
  // -------------------------------------------------------------------------

  onEvent(handler: SseEventHandler): void {
    this.eventHandler = handler;
  }

  onError(handler: SseErrorHandler): void {
    this.errorHandler = handler;
  }

  onOpen(handler: SseOpenHandler): void {
    this.openHandler = handler;
    if (this.openBuffered) {
      this.openBuffered = false;
      handler();
    }
  }

  /**
   * Close the underlying source and suppress all subsequent handler
   * invocations. Idempotent — the source is closed at most once.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.source.close();
    } catch {
      // Already closing — safe to ignore.
    }
  }

  /** True iff the source is closed (by us) or transport-closed. */
  isClosed(): boolean {
    return this.closed || this.source.readyState === READYSTATE_CLOSED;
  }

  // -------------------------------------------------------------------------
  // Inbound message handling.
  // -------------------------------------------------------------------------

  private handleMessage(ev: MessageEvent): void {
    // After close() the consumer opted out — drop everything.
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
    const result = LiveEventSchema.safeParse(parsed);
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
    this.eventHandler?.(result.data);
  }
}
