// Sentry wrapper for the api process.
//
// Per skill `sentry-error-observability` (non-negotiable):
//   - Init once at process start; no-op when SENTRY_DSN is unset.
//   - beforeSend hook scrubs known PII shapes before events leave the process.
//   - HTTP middleware sets user + transaction scope on every request entry.
//   - WS gateway sets scope per-connection (handleConnection) and per-frame
//     (handleMessage) since WS bypasses HTTP middleware.
//
// Call sites:
//   - main.ts                  -> initSentry() before NestFactory boot
//   - SentryRequestMiddleware  -> per-request scope on REST controllers
//   - GlobalExceptionFilter    -> capture uncaught controller errors
//   - chat.gateway.ts          -> withWsScope() for connection + frame events
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Without DSN, Sentry no-ops. Still flip the flag so callers stay idempotent.
    initialized = true;
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    beforeSend(event) {
      // PII scrub. We never intentionally attach emails/tokens to events, but
      // defense-in-depth: redact anything that looks like one inside `extra`.
      if (event.extra) {
        for (const [k, v] of Object.entries(event.extra)) {
          if (typeof v === 'string') {
            event.extra[k] = redactSecrets(v);
          }
        }
      }
      // Strip captured stack-frame variable values if SDK populates them.
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.stacktrace?.frames) {
            for (const f of ex.stacktrace.frames) {
              const fAny = f as unknown as { vars?: unknown };
              if (fAny.vars) delete fAny.vars;
            }
          }
        }
      }
      // Drop the request body entirely if present — it may contain plaintext
      // passwords on /auth/signup or /auth/login.
      if (event.request?.data) {
        event.request.data = '[redacted]';
      }
      return event;
    },
  });
  initialized = true;
}

function redactSecrets(s: string): string {
  return s
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[redacted]');
}

export interface CaptureApiErrorInput {
  err: unknown;
  feature:
    | 'auth'
    | 'conversations'
    | 'chat'
    | 'bootstrap'
    // Phase B (control plane) features.
    | 'auto'
    | 'console'
    | 'replay'
    | 'live'
    | 'janitor'
    | 'heartbeat';
  layer: 'controller' | 'service' | 'repository' | 'gateway' | 'orchestrator';
  statusClass?: '4xx' | '5xx';
  extra?: Record<string, unknown>;
}

export function captureApiError(input: CaptureApiErrorInput): void {
  Sentry.captureException(input.err, {
    tags: {
      feature: input.feature,
      layer: input.layer,
      ...(input.statusClass ? { status_class: input.statusClass } : {}),
    },
    extra: input.extra,
  });
}

export interface WsScopeContext {
  feature: 'chat';
  event: 'connection' | 'frame' | 'stream' | 'disconnect';
  userId?: string;
  conversationId?: string;
  messageId?: string;
  frameType?: string;
}

export async function withWsScope<T>(ctx: WsScopeContext, fn: () => Promise<T>): Promise<T> {
  return Sentry.withScope(async (scope) => {
    scope.setTag('feature', ctx.feature);
    scope.setTag('layer', 'gateway');
    scope.setTag('ws_event', ctx.event);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.conversationId) scope.setExtra('conversationId', ctx.conversationId);
    if (ctx.messageId) scope.setExtra('messageId', ctx.messageId);
    if (ctx.frameType) scope.setExtra('frameType', ctx.frameType);
    return fn();
  });
}

export { Sentry };
