// TraceRow — one row in the Traces feed (LLD Tasks 106-113).
//
// Pure render of a TraceRow DTO: provider/model, status, latency, prompt/
// completion tokens, conversation-title link, timestamp, a per-row Jaeger deep
// link (new tab), and a "Replay" badge when kind === 'replay'. Optionally
// expandable to reveal failover content (passed as children by the tab).
//
// Reconciliations against the authored contract:
//  - The Jaeger deep link is built from the OTel `traceId` the row now carries
//    (R3 reconciliation). When the inference has no trace event yet the api
//    sends an empty `traceId`, so the link is omitted rather than pointing at a
//    bare `/trace/`.
//  - The conversation deep link uses the `conversationId` query key (matching
//    TracesQuerySchema + traces-filter-encoding) so it rehydrates the filter.
//    (The LLD prose's `conversation_id` is stale.)
//  - There is no `deleted` flag on the contract row; the tab passes
//    `conversationDeleted` when it knows the conversation is gone.

'use client';

import { useState, type ReactNode } from 'react';

import type { TraceRow as TraceRowDto } from '@argus/contracts';

function jaegerTraceUrl(traceId: string): string {
  const base = process.env.NEXT_PUBLIC_JAEGER_URL;
  const root = base && base.length > 0 ? base : 'http://localhost:16686';
  return `${root}/trace/${traceId}`;
}

const EM_DASH = '—';
const fmtTokens = (n: number | null): string => (n === null ? EM_DASH : n.toLocaleString());

// Deterministic, locale-independent timestamp (UTC) so SSR and client render
// identically — `toLocaleString()` would drift by host timezone/locale and
// trip React hydration. Readable as "2026-05-25 12:00:00 UTC".
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export type TraceRowProps = {
  row: TraceRowDto;
  /** When true, the conversation title is suffixed with "(deleted)". */
  conversationDeleted?: boolean;
  /** Expansion content (e.g. <FailoverChain />); enables the expand toggle. */
  children?: ReactNode;
};

export function TraceRow({ row, conversationDeleted = false, children }: TraceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const title = row.conversationTitle ?? 'Untitled conversation';
  const expandable = children != null;

  return (
    <div
      data-testid={`console-trace-row-${row.id}`}
      data-kind={row.kind}
      className="flex flex-col gap-1 border-b border-chat-rule px-3 py-2 text-[12.5px]"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-chat-ink">
          {row.provider} · {row.model}
        </span>
        <span data-testid={`console-trace-row-${row.id}-status`} data-status={row.status} className="text-chat-ink-2">
          {row.status}
        </span>
        {row.kind === 'replay' && (
          <span
            data-testid={`console-trace-row-${row.id}-replay-badge`}
            className="rounded-full bg-acc-soft px-2 py-0.5 text-[11px] font-medium text-acc-strong"
          >
            Replay
          </span>
        )}
        <span className="text-chat-ink-3">
          {row.latencyMs === null ? EM_DASH : `${row.latencyMs} ms`}
        </span>
        <span data-testid={`console-trace-row-${row.id}-prompt-tokens`} className="text-chat-ink-3">
          in {fmtTokens(row.promptTokens)}
        </span>
        <span data-testid={`console-trace-row-${row.id}-completion-tokens`} className="text-chat-ink-3">
          out {fmtTokens(row.completionTokens)}
        </span>
        <time dateTime={row.startedAt} className="text-chat-ink-3">
          {formatTimestamp(row.startedAt)}
        </time>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={`/console/traces?conversationId=${encodeURIComponent(row.conversationId)}`}
          data-testid={`console-trace-row-${row.id}-conversation-link`}
          className="text-chat-ink-2 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          {title}
          {conversationDeleted ? ' (deleted)' : ''}
        </a>
        {row.traceId && (
          <a
            href={jaegerTraceUrl(row.traceId)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`console-trace-row-${row.id}-jaeger-link`}
            aria-label="Open trace in Jaeger (new tab)"
            className="text-info underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            Jaeger ↗
          </a>
        )}
        {expandable && (
          <button
            type="button"
            data-testid={`console-trace-row-${row.id}-expand`}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse failover chain' : 'Expand failover chain'}
            onClick={() => setExpanded((v) => !v)}
            className="text-chat-ink-2 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            {expanded ? 'Hide attempts' : 'Show attempts'}
          </button>
        )}
      </div>

      {expandable && expanded && (
        <div data-testid={`console-trace-row-${row.id}-expansion`} className="pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
