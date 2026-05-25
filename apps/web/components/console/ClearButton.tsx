// ClearButton — header trigger that opens the ClearModal (LLD Task 178).
//
// The modal owns its own fetch/confirm/execute flow; this button just toggles
// it open and forwards the cleared callback so the parent can refetch.

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
        className="inline-flex min-h-9 items-center rounded-[6px] border border-chat-rule px-3 py-[7px] text-[12.5px] font-medium text-err hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
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
