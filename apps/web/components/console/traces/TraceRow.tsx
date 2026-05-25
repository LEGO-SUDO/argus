// TraceRow — one row in the Traces table (LLD Tasks 106-113).
//
// Reskinned (REVIEW-BRIEF Finding 4): renders a <tr> inside .con-table instead
// of a card-style <div>. Columns mirror the prototype:
//   status | provider·model | input preview | latency | tokens p/c | cost | when
//
// Preserved from the original:
//   - All data-testid / aria attributes
//   - Jaeger deep link (OTel traceId)
//   - Conversation deep link (conversationId filter)
//   - Replay badge when kind === 'replay'
//   - conversationDeleted flag
//   - The expand toggle for failover chain children
//   - new-row flash class support (passed via prop, applied to the <tr>)

'use client';

import { useState, type ReactNode } from 'react';

import type { TraceRow as TraceRowDto } from '@argus/contracts';

// ---- helpers ----------------------------------------------------------------

const EM_DASH = '—';

function jaegerTraceUrl(traceId: string): string {
  const base = process.env.NEXT_PUBLIC_JAEGER_URL;
  const root = base && base.length > 0 ? base : 'http://localhost:16686';
  return `${root}/trace/${traceId}`;
}

const fmtTokens = (n: number | null): string => (n === null ? EM_DASH : n.toLocaleString());

/** Relative time: "just now" / "Xs ago" / "Xm ago" / "Xh ago". */
function relTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 5000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3600_000)}h ago`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return EM_DASH;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function fmtUSD(micros: number | null): string {
  if (micros === null) return EM_DASH;
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

// ---- StatusPill (inline, mirrors prototype) ---------------------------------

function StatusPill({ status }: { status: string }) {
  if (status === 'streaming')
    return <span className="pill streaming"><span className="pdot" />streaming</span>;
  if (status === 'ok')
    return <span className="pill ok"><span className="pdot" />ok</span>;
  if (status === 'failed')
    return <span className="pill err"><span className="pdot" />failed</span>;
  if (status === 'timed_out')
    return <span className="pill err"><span className="pdot" />timed_out</span>;
  if (status === 'canceled')
    return <span className="pill cancel"><span className="pdot" />canceled</span>;
  return <span className="pill">{status}</span>;
}

// ---- TraceRow ---------------------------------------------------------------

export type TraceRowProps = {
  row: TraceRowDto;
  /** When true, the conversation title is suffixed with "(deleted)". */
  conversationDeleted?: boolean;
  /** When true, applies the .new-row flash class. */
  isNew?: boolean;
  /** Click handler — opens the drawer. */
  onClick?: () => void;
  /** Expansion content (e.g. <FailoverChain />); enables the expand toggle. */
  children?: ReactNode;
};

export function TraceRow({
  row,
  conversationDeleted = false,
  isNew = false,
  onClick,
  children,
}: TraceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const title = row.conversationTitle ?? 'Untitled conversation';
  const expandable = children != null;

  const inputPreview = row.inputPreview
    ? row.inputPreview.slice(0, 80) + (row.inputPreview.length > 80 ? '…' : '')
    : EM_DASH;

  return (
    <>
      <tr
        data-testid={`console-trace-row-${row.id}`}
        data-kind={row.kind}
        className={isNew ? 'new-row' : undefined}
        onClick={onClick}
        role="row"
        aria-label={`Trace: ${row.provider} ${row.model} — ${row.status}`}
        style={{ cursor: onClick ? 'pointer' : undefined }}
      >
        {/* status */}
        <td>
          <span
            data-testid={`console-trace-row-${row.id}-status`}
            data-status={row.status}
          >
            <StatusPill status={row.status} />
          </span>
        </td>

        {/* provider · model */}
        <td>
          <span className="ptag" data-prov={row.provider}>
            <span className="swatch" aria-hidden="true" />
            <span>{row.provider}</span>
            <span className="model">{row.model}</span>
          </span>
          {row.kind === 'replay' && (
            <span
              data-testid={`console-trace-row-${row.id}-replay-badge`}
              aria-label="Replay"
              style={{
                marginLeft: 6,
                fontSize: '10px',
                color: 'var(--acc)',
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                border: '1px solid oklch(0.6 0.13 30 / 0.4)',
                borderRadius: 3,
                padding: '1px 5px',
              }}
            >
              replay
            </span>
          )}
        </td>

        {/* input preview */}
        <td
          className="dim"
          style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {inputPreview}
        </td>

        {/* latency */}
        <td className="num">
          {fmtMs(row.latencyMs)}
        </td>

        {/* tokens prompt / completion */}
        <td className="num dim">
          <span
            data-testid={`console-trace-row-${row.id}-prompt-tokens`}
            style={{ color: 'var(--con-text)' }}
          >
            {fmtTokens(row.promptTokens)}
          </span>
          <span style={{ color: 'var(--con-dim)' }}> / </span>
          <span
            data-testid={`console-trace-row-${row.id}-completion-tokens`}
            style={{ color: 'var(--con-text)' }}
          >
            {fmtTokens(row.completionTokens)}
          </span>
        </td>

        {/* cost */}
        <td className="num">
          {row.totalCostMicros !== null
            ? fmtUSD(row.totalCostMicros)
            : <span className="dim">{EM_DASH}</span>
          }
        </td>

        {/* when (relative timestamp) */}
        <td className="num ts">
          <time dateTime={row.startedAt}>{relTime(row.startedAt)}</time>
        </td>

        {/* sub-row controls: jaeger + conversation link + expand toggle */}
        <td>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              fontSize: '11px',
            }}
          >
            {row.traceId && (
              <a
                href={jaegerTraceUrl(row.traceId)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`console-trace-row-${row.id}-jaeger-link`}
                aria-label="Open trace in Jaeger (new tab)"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: 'var(--info)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                }}
              >
                ↗
              </a>
            )}
            <a
              href={`/console/traces?conversationId=${encodeURIComponent(row.conversationId)}`}
              data-testid={`console-trace-row-${row.id}-conversation-link`}
              onClick={(e) => e.stopPropagation()}
              style={{
                color: 'var(--con-dim)',
                textDecoration: 'none',
                maxWidth: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'inline-block',
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              }}
            >
              {title}
              {conversationDeleted ? ' (deleted)' : ''}
            </a>
            {expandable && (
              <button
                type="button"
                data-testid={`console-trace-row-${row.id}-expand`}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse failover chain' : 'Expand failover chain'}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                style={{
                  fontSize: '10px',
                  color: 'var(--con-dim)',
                  fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                  border: '1px solid var(--con-rule)',
                  borderRadius: 3,
                  padding: '1px 5px',
                  background: 'var(--con-panel)',
                }}
              >
                {expanded ? 'hide' : 'attempts'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expansion row for failover chain */}
      {expandable && expanded && (
        <tr>
          <td
            colSpan={8}
            data-testid={`console-trace-row-${row.id}-expansion`}
            style={{ padding: '0 14px 10px', background: 'var(--con-panel)' }}
          >
            {children}
          </td>
        </tr>
      )}
    </>
  );
}
