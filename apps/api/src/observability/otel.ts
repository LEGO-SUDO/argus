// OTel SDK init for the api process.
//
// Spans emitted by `@argus/sdk` (chat.stream → llm.chat span) must flow
// somewhere or the workers projection consumer sees zero traffic. The host
// process initializes the SDK once with an OTLP/HTTP exporter pointing at
// OTEL_EXPORTER_OTLP_ENDPOINT; the global tracer provider that
// `@opentelemetry/api` exposes from there is what packages/sdk reaches for.
//
// Quiet mode: if OTEL_EXPORTER_OTLP_ENDPOINT is unset, we don't start the
// SDK and `trace.getTracer(...)` returns the API's built-in no-op tracer.
// This lets unit tests + keyless dev runs avoid network noise without
// touching the SDK code.

import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let started = false;
let sdkInstance: NodeSDK | undefined;

export function initOtel(): void {
  if (started) return;
  started = true;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // No collector configured — keep the no-op tracer. The SDK still emits
    // its lifecycle spans but they go to a no-op processor.
    return;
  }
  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });
  // Explicit BatchSpanProcessor with a 500ms flush (REVIEW-BRIEF Finding 2).
  // NodeSDK's default `traceExporter` wiring builds a BatchSpanProcessor with
  // the SDK default `scheduledDelayMillis: 5000` — a span emitted just after a
  // flush would wait ~5s before it even leaves the API, which is the dominant
  // term in the PRD's "~5s end-to-end" budget and can blow it. 500ms keeps the
  // batch small without busy-flushing on every span.
  sdkInstance = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'argus-api',
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'argus-api',
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? '0.0.0',
    }),
    spanProcessors: [new tracing.BatchSpanProcessor(exporter, { scheduledDelayMillis: 500 })],
  });
  sdkInstance.start();

  // Best-effort flush on shutdown — main.ts wires SIGINT/SIGTERM through
  // app.close, so the process won't exit before this Promise resolves
  // unless something else forces it.
  const flush = async (): Promise<void> => {
    try {
      await sdkInstance?.shutdown();
    } catch {
      // swallow — process is on its way out
    }
  };
  process.once('beforeExit', () => void flush());
}
