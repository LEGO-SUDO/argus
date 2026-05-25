// DiffToggle — toggles the side-by-side pane between raw and diff view (LLD
// Phase 9 / Task 177). Pure, controlled.

'use client';

export type DiffViewMode = 'raw' | 'diff';

export type DiffToggleProps = {
  mode: DiffViewMode;
  onChange: (mode: DiffViewMode) => void;
};

export function DiffToggle({ mode, onChange }: DiffToggleProps) {
  return (
    <div
      data-testid="console-replay-diff-toggle"
      role="group"
      aria-label="Diff view mode"
      className="inline-flex items-center rounded-[6px] border border-con-rule p-0.5"
    >
      {(['raw', 'diff'] as const).map((option) => (
        <button
          key={option}
          type="button"
          data-testid={`console-replay-diff-toggle-${option}`}
          aria-pressed={mode === option}
          aria-label={`${option} view`}
          onClick={() => onChange(option)}
          className={`min-h-8 rounded-[5px] px-2.5 py-1 text-[12px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
            mode === option ? 'bg-con-text text-con-bg' : 'text-con-dim hover:bg-con-hover'
          }`}
        >
          {option === 'raw' ? 'Raw' : 'Diff'}
        </button>
      ))}
    </div>
  );
}
