// ResetToOriginalButton — restores the picker's provider/model to the source
// row's values (LLD Phase 9 / Task 177). Pure render.

'use client';

export type ResetToOriginalButtonProps = {
  onReset: () => void;
  disabled?: boolean;
};

export function ResetToOriginalButton({ onReset, disabled }: ResetToOriginalButtonProps) {
  return (
    <button
      type="button"
      data-testid="console-replay-reset"
      aria-label="Reset provider and model to the original"
      disabled={disabled}
      onClick={() => onReset()}
      className="min-h-8 rounded-[6px] border border-chat-rule px-2.5 py-1 text-[12px] font-medium text-chat-ink-2 hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40"
    >
      Reset to original
    </button>
  );
}
