// LiveBadge — the three-state freshness indicator in the console topbar.
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses .live-pill
// from console.css: pulsing green dot for live, .lag for behind, .err for error.
// All existing data-testids, role, aria-* attributes, and retry behavior are
// fully preserved.

'use client';

import { useLiveBadge, type UseLiveBadgeOptions } from '@/lib/use-live-badge';

// Maps badge state to the modifier class added to .live-pill.
const PILL_CLASS: Record<string, string> = {
  live: '',
  behind: ' lag',
  error: ' err',
};

export function LiveBadge(props: UseLiveBadgeOptions) {
  const { state, label, refetch } = useLiveBadge(props);
  const modifierClass = PILL_CLASS[state] ?? '';

  return (
    <div
      data-testid="console-live-badge"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-label={`Live status: ${label}`}
      className={`live-pill${modifierClass}`}
    >
      <span
        aria-hidden="true"
        className="dot"
      />
      <span data-testid="console-live-badge-label">{label}</span>
      {state === 'error' && (
        <button
          type="button"
          data-testid="console-live-badge-retry"
          aria-label="Retry live connection"
          onClick={() => void refetch()}
          style={{
            marginLeft: 4,
            fontSize: 10.5,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            color: 'var(--err)',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
            padding: '1px 4px',
            borderRadius: 3,
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
