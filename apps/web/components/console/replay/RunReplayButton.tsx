// RunReplayButton — triggers the replay run; disabled while running (LLD
// Phase 9 / Task 177). Pure render.
//
// Accepts an optional `className` prop so callers can apply the `.run-btn`
// CSS class from console.css (dev-tool reskin, REVIEW-BRIEF Finding 4).

'use client';

import { Icon } from '@/components/console/Icon';

export type RunReplayButtonProps = {
  onRun: () => void;
  running: boolean;
  disabled?: boolean;
  /** Extra class names — used by ReplayPickerBar to apply `.run-btn`. */
  className?: string;
};

function Spinner() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ animation: 'spin 0.9s linear infinite' }}
    >
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="14 40"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export function RunReplayButton({ onRun, running, disabled, className }: RunReplayButtonProps) {
  const baseClass =
    'inline-flex min-h-9 items-center rounded-[6px] bg-con-text px-3 py-[7px] text-[12.5px] font-medium text-con-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <button
      type="button"
      data-testid="console-replay-run-button"
      aria-label="Run replay"
      disabled={running || disabled}
      onClick={() => onRun()}
      className={className ?? baseClass}
    >
      {running ? (
        <>
          <Spinner />
          <span style={{ marginLeft: 6 }}>Replaying…</span>
        </>
      ) : (
        <>
          <Icon name="replay" size={11} aria-hidden="true" />
          <span style={{ marginLeft: 6 }}>Run replay</span>
        </>
      )}
    </button>
  );
}
