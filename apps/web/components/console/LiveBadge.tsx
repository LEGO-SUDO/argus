// LiveBadge — the three-state freshness indicator in the console header.
//
// LLD frontend-web Phase 2 (Tasks 30-31). Pure render over `useLiveBadge`:
// the state machine + polling live in the hook; this component only paints the
// derived `{ state, label }` and exposes a Retry control in the error state.
// Color is never the only signal — the label text differs per state and the
// error state adds an explicit Retry button.

'use client';

import { useLiveBadge, type UseLiveBadgeOptions } from '@/lib/use-live-badge';

// Dot color per state — tokens shared across surfaces (globals.css).
const DOT_CLASS: Record<string, string> = {
  live: 'bg-ok',
  behind: 'bg-warn',
  error: 'bg-err',
};

export function LiveBadge(props: UseLiveBadgeOptions) {
  const { state, label, refetch } = useLiveBadge(props);

  return (
    <div
      data-testid="console-live-badge"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-label={`Live status: ${label}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-chat-rule bg-chat-panel px-2.5 py-[3px] text-[11.5px] text-chat-ink-2"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${DOT_CLASS[state] ?? 'bg-chat-ink-3'}`}
      />
      <span data-testid="console-live-badge-label">{label}</span>
      {state === 'error' && (
        <button
          type="button"
          data-testid="console-live-badge-retry"
          aria-label="Retry live connection"
          onClick={() => void refetch()}
          className="ml-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-err underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          Retry
        </button>
      )}
    </div>
  );
}
