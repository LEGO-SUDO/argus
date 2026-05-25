// ReplayPicker — candidate list for the replay tab (LLD Tasks 150-153).
//
// Renders one selectable entry per candidate (filtered by the Traces window
// passed in as a prop) with an accessible status label; a canceled candidate
// additionally shows a "partial input only" warning. Pure render + onSelect.
//
// Reskinned to the dev-tool design language (REVIEW-BRIEF Finding 4).
// Used both as a standalone list (no-source state) and inside the SourceMenu
// dropdown in ReplayPickerBar. All data-testids and ARIA attributes preserved.

'use client';

import type { ReplayCandidate, TimeWindow } from '@argus/contracts';

const WINDOW_MS: Record<Exclude<TimeWindow, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

function withinWindow(startedAt: string, window: TimeWindow, now: number): boolean {
  if (window === 'all') return true;
  const cutoff = now - WINDOW_MS[window];
  return Date.parse(startedAt) >= cutoff;
}

const STATUS_PILL: Record<string, string> = {
  ok: 'pill ok',
  failed: 'pill err',
  timed_out: 'pill warn',
  canceled: 'pill cancel',
  streaming: 'pill streaming',
};

export type ReplayPickerProps = {
  candidates: ReplayCandidate[];
  window: TimeWindow;
  onSelect: (candidate: ReplayCandidate) => void;
  /** Injectable clock for deterministic tests. */
  now?: number;
};

export function ReplayPicker({ candidates, window, onSelect, now = Date.now() }: ReplayPickerProps) {
  const visible = candidates.filter((c) => withinWindow(c.startedAt, window, now));

  return (
    <ul data-testid="console-replay-picker" role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {visible.map((candidate) => (
        <li key={candidate.id}>
          <button
            type="button"
            data-testid={`console-replay-candidate-${candidate.id}`}
            aria-label={`Replay candidate ${candidate.model}, status ${candidate.status}`}
            onClick={() => onSelect(candidate)}
            role="option"
            aria-selected={false}
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 110px 1fr',
              gap: 10,
              alignItems: 'center',
              width: '100%',
              padding: '7px 9px',
              borderRadius: 4,
              textAlign: 'left',
              color: 'var(--con-text)',
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 11.5,
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--con-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            {/* Status pill */}
            <span
              data-testid={`console-replay-candidate-${candidate.id}-status`}
              data-status={candidate.status}
              className={STATUS_PILL[candidate.status] ?? 'pill'}
              aria-label={`Status: ${candidate.status}`}
            >
              <span className="pdot" aria-hidden="true" />
              {candidate.status}
            </span>

            {/* Provider tag */}
            <span className="ptag" data-prov={candidate.provider}>
              <span className="swatch" aria-hidden="true" />
              {candidate.provider}
            </span>

            {/* Input preview + conversation title */}
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  color: 'var(--con-dim)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {candidate.inputPreview ?? candidate.conversationTitle ?? 'Untitled conversation'}
              </span>
              {candidate.status === 'canceled' && (
                <span
                  data-testid={`console-replay-candidate-${candidate.id}-warning`}
                  style={{ color: 'var(--warn)', fontSize: 10.5, marginTop: 2, display: 'block' }}
                >
                  Partial input only — original was canceled before completing.
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
