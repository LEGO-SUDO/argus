// ReplayPicker — candidate list for the replay tab (LLD Tasks 150-153).
//
// Renders one selectable entry per candidate (filtered by the Traces window
// passed in as a prop) with an accessible status label; a canceled candidate
// additionally shows a "partial input only" warning. Pure render + onSelect.

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
    <ul data-testid="console-replay-picker" role="list" className="flex flex-col gap-1">
      {visible.map((candidate) => (
        <li key={candidate.id}>
          <button
            type="button"
            data-testid={`console-replay-candidate-${candidate.id}`}
            aria-label={`Replay candidate ${candidate.model}, status ${candidate.status}`}
            onClick={() => onSelect(candidate)}
            className="flex w-full flex-col gap-0.5 rounded-md border border-chat-rule px-3 py-2 text-left hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            <span className="flex items-center gap-2 text-[12.5px] text-chat-ink">
              <span className="font-medium">
                {candidate.provider} · {candidate.model}
              </span>
              <span
                data-testid={`console-replay-candidate-${candidate.id}-status`}
                data-status={candidate.status}
                className="text-chat-ink-2"
              >
                {candidate.status}
              </span>
            </span>
            <span className="truncate text-[11.5px] text-chat-ink-3">
              {candidate.conversationTitle ?? 'Untitled conversation'}
            </span>
            {candidate.status === 'canceled' && (
              <span
                data-testid={`console-replay-candidate-${candidate.id}-warning`}
                className="text-[11px] text-warn"
              >
                Partial input only — original was canceled before completing.
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
