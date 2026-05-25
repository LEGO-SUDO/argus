// ClearButton — header trigger that opens the ClearModal (LLD Task 178).
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses
// .filter-chip styling to match the topbar. All existing data-testids,
// aria-* attributes, and behavior are fully preserved.

'use client';

import { useState } from 'react';

import { ClearModal } from './ClearModal';

export type ClearButtonProps = {
  onCleared?: () => void;
};

export function ClearButton({ onCleared }: ClearButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        data-testid="console-clear-button"
        aria-label="Clear console data"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="filter-chip"
        style={{ color: 'var(--err)', borderColor: 'oklch(0.66 0.18 25 / 0.3)' }}
      >
        Clear data
      </button>
      {open && (
        <ClearModal
          onClose={() => setOpen(false)}
          onCleared={() => {
            setOpen(false);
            onCleared?.();
          }}
        />
      )}
    </>
  );
}
