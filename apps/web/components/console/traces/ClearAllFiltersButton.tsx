// ClearAllFiltersButton — emits the empty-filter event (LLD Tasks 100-101).
// Reskinned to .filter-chip styling (REVIEW-BRIEF Finding 4).

'use client';

import { Icon } from '../Icon';

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
      className="filter-chip"
      style={{ color: 'var(--con-dim-2)', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : undefined }}
    >
      <Icon name="x" size={9} aria-hidden="true" />
      clear
    </button>
  );
}
