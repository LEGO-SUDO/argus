// PaneExpandControl — opens a full-screen scrollable view of one pane (LLD
// Phase 9 / Task 177). Pure render; the parent owns what "expand" does.

'use client';

export type PaneExpandControlProps = {
  label: string;
  onExpand: () => void;
};

export function PaneExpandControl({ label, onExpand }: PaneExpandControlProps) {
  return (
    <button
      type="button"
      data-testid={`console-replay-pane-expand-${label}`}
      aria-label={`Expand ${label} pane`}
      onClick={() => onExpand()}
      className="text-[11px] text-chat-ink-2 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
    >
      Expand
    </button>
  );
}
