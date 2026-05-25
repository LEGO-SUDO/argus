// RunReplayButton — triggers the replay run; disabled while running (LLD
// Phase 9 / Task 177). Pure render.

'use client';

export type RunReplayButtonProps = {
  onRun: () => void;
  running: boolean;
  disabled?: boolean;
};

export function RunReplayButton({ onRun, running, disabled }: RunReplayButtonProps) {
  return (
    <button
      type="button"
      data-testid="console-replay-run-button"
      aria-label="Run replay"
      disabled={running || disabled}
      onClick={() => onRun()}
      className="inline-flex min-h-9 items-center rounded-[6px] bg-chat-ink px-3 py-[7px] text-[12.5px] font-medium text-chat-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40"
    >
      {running ? 'Running…' : 'Run replay'}
    </button>
  );
}
