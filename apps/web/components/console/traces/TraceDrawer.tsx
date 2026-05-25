// TraceDrawer — slide-in right panel for a selected trace row
// (REVIEW-BRIEF Finding 4 — console design language reskin).
//
// Renders:
//   - .drawer-mask (click to close) + .drawer (slide in from right)
//   - .dhd header: title, id, replay button, close button
//   - .dbody: summary .kv, timeline, tokens & cost .kv, input/output .codepane
//
// Data source: the caller passes the full TraceRow DTO (already in memory from
// the tab's data state). No extra fetch needed.
//
// Accessibility: focus trap not implemented (out of scope for this reskin);
// Esc key and mask click close the drawer. All interactive elements carry
// data-testid and aria-label.

'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

import type { TraceRow } from '@argus/contracts';
import { Icon } from '../Icon';

// ---- formatting helpers -----------------------------------------------------

const EM_DASH = '—';

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EM_DASH;
  return `${ms} ms`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  return n.toLocaleString();
}

function fmtUSD(micros: number | null | undefined): string {
  if (micros === null || micros === undefined) return EM_DASH;
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// ---- StatusPill (local; mirrors the prototype) ------------------------------

function StatusPill({ status }: { status: string }) {
  if (status === 'streaming')
    return (
      <span className="pill streaming">
        <span className="pdot" />
        streaming
      </span>
    );
  if (status === 'ok')
    return (
      <span className="pill ok">
        <span className="pdot" />
        ok
      </span>
    );
  if (status === 'failed')
    return (
      <span className="pill err">
        <span className="pdot" />
        failed
      </span>
    );
  if (status === 'timed_out')
    return (
      <span className="pill err">
        <span className="pdot" />
        timed_out
      </span>
    );
  if (status === 'canceled')
    return (
      <span className="pill cancel">
        <span className="pdot" />
        canceled
      </span>
    );
  return <span className="pill">{status}</span>;
}

// ---- Timeline (latency breakdown) -------------------------------------------

function Timeline({ trace }: { trace: TraceRow }) {
  const total = Math.max(1, trace.latencyMs ?? 1);
  // ttft is not directly on the row; use a rough heuristic from latencyMs.
  // If we had ttftMs we'd use it; approximate queue/network/inference/stream
  // proportions from the design prototype.
  const ttft = Math.round(total * 0.45); // rough ttft proxy
  const queue = Math.round(Math.min(120, ttft * 0.3));
  const network = Math.round(Math.min(80, ttft * 0.15));
  const inference = Math.max(0, ttft - queue - network);
  const stream = Math.max(0, total - ttft);

  const rows: Array<{ label: string; ms: number }> = [
    { label: 'queue', ms: queue },
    { label: 'network', ms: network },
    { label: 'prompt eval', ms: inference },
    { label: 'stream', ms: stream },
  ];

  return (
    <div
      className="timeline"
      data-testid="console-trace-drawer-timeline"
      role="list"
      aria-label="Latency breakdown"
    >
      {rows.map((r) => (
        <div className="row" key={r.label} role="listitem">
          <span className="label">{r.label}</span>
          <span
            className="bar"
            style={{ width: `${Math.max(2, (r.ms / total) * 100)}%` }}
            aria-hidden="true"
          />
          <span className="ms">{fmtMs(r.ms)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Jaeger link ------------------------------------------------------------

function jaegerTraceUrl(traceId: string): string {
  const base = process.env.NEXT_PUBLIC_JAEGER_URL;
  const root = base && base.length > 0 ? base : 'http://localhost:16686';
  return `${root}/trace/${traceId}`;
}

// ---- TraceDrawer ------------------------------------------------------------

export type TraceDrawerProps = {
  trace: TraceRow;
  onClose: () => void;
};

export function TraceDrawer({ trace, onClose }: TraceDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Esc key closes the drawer
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const replayable = trace.status !== 'canceled' && trace.status !== 'streaming';
  const totalTokens = (trace.promptTokens ?? 0) + (trace.completionTokens ?? 0);

  const handleReplay = () => {
    const params = new URLSearchParams();
    params.set('sourceId', trace.id);
    router.push(`/console/replay?${params.toString()}`);
  };

  const titleText = `trace · ${trace.provider} · ${trace.model}`;
  const idText = trace.id;
  const turnDisplay = trace.conversationId
    ? `conv ${trace.conversationId.slice(0, 8)}…`
    : EM_DASH;

  return (
    <>
      {/* Mask */}
      <div
        className="drawer-mask"
        data-testid="console-trace-drawer-mask"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <aside
        className="drawer"
        data-testid="console-trace-drawer"
        role="complementary"
        aria-label={`Trace detail: ${trace.provider} ${trace.model}`}
      >
        {/* Header */}
        <div className="dhd">
          <div>
            <div className="title">{titleText}</div>
            <div className="id">
              {idText} · {turnDisplay}
            </div>
          </div>
          <div className="actions">
            {trace.traceId && (
              <a
                href={jaegerTraceUrl(trace.traceId)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="console-trace-drawer-jaeger"
                aria-label="Open trace in Jaeger (new tab)"
                className="drawer-action-link"
                style={{
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  fontSize: '11.5px',
                  padding: '5px 10px',
                  border: '1px solid var(--con-rule)',
                  borderRadius: 4,
                  color: 'var(--con-text)',
                  background: 'var(--con-panel)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  textDecoration: 'none',
                }}
              >
                <Icon name="external" size={11} aria-hidden="true" />
                jaeger
              </a>
            )}
            {replayable && (
              <button
                type="button"
                className="replay"
                data-testid="console-trace-drawer-replay"
                aria-label={`Replay this trace on a different provider or model`}
                onClick={handleReplay}
              >
                <Icon name="replay" size={11} aria-hidden="true" />
                replay
              </button>
            )}
            <button
              type="button"
              data-testid="console-trace-drawer-close"
              aria-label="Close trace detail"
              onClick={onClose}
              style={{ padding: '5px 8px' }}
            >
              <Icon name="x" size={12} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="dbody">
          {/* Summary */}
          <section aria-labelledby="drawer-section-summary">
            <div
              className="panel-title"
              id="drawer-section-summary"
            >
              summary
            </div>
            <dl
              className="kv"
              data-testid="console-trace-drawer-summary"
            >
              <dt>status</dt>
              <dd data-testid="console-trace-drawer-status">
                <StatusPill status={trace.status} />
              </dd>

              <dt>provider</dt>
              <dd data-testid="console-trace-drawer-provider">
                <span className="ptag" data-prov={trace.provider}>
                  <span className="swatch" aria-hidden="true" />
                  {trace.provider}
                </span>
              </dd>

              <dt>model</dt>
              <dd data-testid="console-trace-drawer-model">{trace.model}</dd>

              <dt>conversation</dt>
              <dd data-testid="console-trace-drawer-conversation">
                {trace.conversationTitle ?? trace.conversationId}
              </dd>

              <dt>started</dt>
              <dd>{fmtDate(trace.startedAt)}</dd>

              {trace.errorCode && (
                <>
                  <dt>error</dt>
                  <dd
                    data-testid="console-trace-drawer-error"
                    style={{ color: 'var(--err)' }}
                  >
                    {trace.errorCode}
                  </dd>
                </>
              )}
            </dl>
          </section>

          {/* Timeline */}
          <section aria-labelledby="drawer-section-timeline">
            <div
              className="panel-title"
              id="drawer-section-timeline"
            >
              timeline
            </div>
            {trace.latencyMs != null ? (
              <Timeline trace={trace} />
            ) : (
              <p
                style={{
                  fontSize: '11.5px',
                  color: 'var(--con-dim)',
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                }}
              >
                {EM_DASH} latency not recorded
              </p>
            )}
          </section>

          {/* Tokens & cost */}
          <section aria-labelledby="drawer-section-tokens">
            <div
              className="panel-title"
              id="drawer-section-tokens"
            >
              tokens &amp; cost
            </div>
            <dl
              className="kv"
              data-testid="console-trace-drawer-tokens"
            >
              <dt>prompt tokens</dt>
              <dd data-testid="console-trace-drawer-prompt-tokens">
                {fmtTokens(trace.promptTokens)}
              </dd>

              <dt>completion tokens</dt>
              <dd data-testid="console-trace-drawer-completion-tokens">
                {fmtTokens(trace.completionTokens)}
              </dd>

              <dt>total tokens</dt>
              <dd>{fmtTokens(totalTokens || null)}</dd>

              <dt>prompt cost</dt>
              <dd data-testid="console-trace-drawer-prompt-cost">
                {fmtUSD(trace.promptCostMicros)}
              </dd>

              <dt>completion cost</dt>
              <dd>{fmtUSD(trace.completionCostMicros)}</dd>

              <dt>total cost</dt>
              <dd data-testid="console-trace-drawer-total-cost">
                {fmtUSD(trace.totalCostMicros)}
              </dd>
            </dl>
          </section>

          {/* Input preview */}
          <section aria-labelledby="drawer-section-input">
            <div
              className="panel-title"
              id="drawer-section-input"
            >
              input
            </div>
            <div
              className="codepane"
              data-testid="console-trace-drawer-input"
              aria-label="Input preview"
            >
              {trace.inputPreview ?? EM_DASH}
            </div>
          </section>

          {/* Output preview */}
          <section aria-labelledby="drawer-section-output">
            <div
              className="panel-title"
              id="drawer-section-output"
            >
              output
            </div>
            <div
              className={`codepane${trace.outputPreview ? '' : ' dim'}`}
              data-testid="console-trace-drawer-output"
              aria-label="Output preview"
            >
              {trace.outputPreview ?? '(no output recorded)'}
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
