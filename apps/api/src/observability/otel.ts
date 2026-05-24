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

import { NodeSDK } from '@opentelemetry/sdk-node';
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
  sdkInstance = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'argus-api',
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'argus-api',
      [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION ?? '0.0.0',
    }),
    traceExporter: exporter,
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
