// ClearAllFiltersButton — emits the empty-filter event (LLD Tasks 100-101).

'use client';

export type ClearAllFiltersButtonProps = {
  onClear: () => void;
  disabled?: boolean;
};

export function ClearAllFiltersButton({ onClear, disabled }: ClearAllFiltersButtonProps) {
  return (
    <button
      type="button"
      data-testid="console-filter-clear-all"
      aria-label="Clear all filters"
      onClick={() => onClear()}
      disabled={disabled}
      className="min-h-8 rounded-[6px] px-2.5 py-1 text-[12px] font-medium text-chat-ink-2 underline-offset-2 hover:text-chat-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40"
    >
      Clear all filters
    </button>
  );
}
