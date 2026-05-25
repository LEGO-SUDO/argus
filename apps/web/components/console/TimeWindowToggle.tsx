// TimeWindowToggle — controlled 24h / 7d / all segmented control.
//
// LLD frontend-web Phase 6 (Tasks 72-73). Pure, controlled: the parent tab
// owns the value; clicking an option emits it. The selected option announces
// itself via `aria-pressed`.

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
      className="inline-flex items-center rounded-[6px] border border-chat-rule bg-chat-panel p-0.5"
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
            className={`min-h-8 rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
              selected ? 'bg-chat-ink text-chat-bg' : 'text-chat-ink-2 hover:bg-chat-hover'
            }`}
          >
            {LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
