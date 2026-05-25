// TimeWindowToggle — controlled 24h / 7d / all segmented control.
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses
// .window-switch from console.css. All existing data-testids, aria-pressed,
// props, and behavior are fully preserved.

'use client';

import { TimeWindowSchema, type TimeWindow } from '@argus/contracts';

const OPTIONS = TimeWindowSchema.options;
const LABELS: Record<TimeWindow, string> = { '24h': '24h', '7d': '7d', all: 'All' };

export type TimeWindowToggleProps = {
  value: TimeWindow;
  onChange: (value: TimeWindow) => void;
};

export function TimeWindowToggle({ value, onChange }: TimeWindowToggleProps) {
  return (
    <div
      data-testid="console-time-window-toggle"
      role="group"
      aria-label="Time window"
      className="window-switch"
    >
      {OPTIONS.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            data-testid={`console-time-window-${option}`}
            aria-pressed={selected}
            aria-label={`Show ${LABELS[option]}`}
            onClick={() => onChange(option)}
            className={selected ? 'active' : ''}
          >
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
