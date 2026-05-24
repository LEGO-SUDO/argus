// Sentry wrapper for the workers process.
//
// Per skill `sentry-error-observability` (non-negotiable):
//   - Init once at process start; no-op when SENTRY_DSN is unset.
//   - beforeSend hook scrubs known PII shapes before events leave the process.
//   - Workers don't go through HTTP middleware, so every consumer / cron
//     handler MUST set scope explicitly at handler entry and capture
//     exceptions with `layer` + `recoverable` tags.
//
// Call sites:
//   - main.ts            -> initSentry() before NestFactory boot
//   - projection.consumer.ts -> withConsumerScope() wraps every batch
//   - projection.service.ts  -> captureProjectionError() for in-handler failures
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // Without DSN, Sentry no-ops. We still set initialized=true so callers
    // can rely on idempotency.
    initialized = true;
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    beforeSend(event) {
      // PII scrub. We don't intentionally attach emails / tokens to events,
      // but defense-in-depth: redact anything that looks like one inside
      // extra fields.
      if (event.extra) {
        for (const [k, v] of Object.entries(event.extra)) {
          if (typeof v === 'string') {
            event.extra[k] = redactSecrets(v);
          }
        }
      }
      // Stack-frame variables can leak. Strip frames' `vars` if SDK ever
      // populates them.
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
      return event;
    },
  });
  initialized = true;
}

function redactSecrets(s: string): string {
  return s
    // Emails
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    // Bearer/Authorization tokens
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]+/gi, '$1[redacted]')
    // Long hex/base64-ish strings (likely keys)
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[redacted]');
}

export interface ConsumerScopeContext {
  consumer: string;
  topic: string;
  partition?: number;
  offset?: string;
  messageKey?: string;
}

/**
 * Wrap a consumer handler in a Sentry scope so any captured exception inside
 * carries consumer/topic/partition/offset tags automatically.
 *
 * Skill requirement: every consumer handler entry MUST set scope explicitly.
 */
export async function withConsumerScope<T>(
  ctx: ConsumerScopeContext,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.withScope(async (scope) => {
    scope.setTag('consumer', ctx.consumer);
    scope.setTag('topic', ctx.topic);
    if (ctx.partition !== undefined) scope.setExtra('partition', ctx.partition);
    if (ctx.offset !== undefined) scope.setExtra('offset', ctx.offset);
    if (ctx.messageKey !== undefined) scope.setExtra('messageKey', ctx.messageKey);
    scope.setTag('layer', 'consumer');
    return fn();
  });
}

export interface CaptureProjectionErrorInput {
  err: unknown;
  layer: 'consumer' | 'service' | 'mapper' | 'projection' | 'dlq';
  recoverable: 'yes' | 'no';
  extra?: Record<string, unknown>;
}

export function captureProjectionError(input: CaptureProjectionErrorInput): void {
  Sentry.captureException(input.err, {
    tags: {
      layer: input.layer,
      recoverable: input.recoverable,
    },
    extra: input.extra,
  });
}

// Re-export Sentry so call sites have one import path.
export { Sentry };
