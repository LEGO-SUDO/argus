// UnpricedBadge — "(N rows missing pricing)" with an expandable list of the
// unpriced models (LLD Tasks 134-135). Renders nothing when there is nothing
// unpriced.

'use client';

import { useState } from 'react';

export type UnpricedBadgeProps = {
  count: number;
  models: string[];
};

export function UnpricedBadge({ count, models }: UnpricedBadgeProps) {
  const [open, setOpen] = useState(false);

  if (count <= 0) {
    return null;
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-testid="console-unpriced-badge"
        aria-expanded={open}
        aria-label={`${count} rows missing pricing`}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-warn px-2 py-0.5 text-[11px] font-medium text-warn focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
      >
        {count} missing pricing
      </button>
      {open && (
        <ul
          data-testid="console-unpriced-badge-popover"
          role="list"
          className="absolute left-0 top-full z-10 mt-1 max-h-40 min-w-40 overflow-auto rounded-md border border-con-rule bg-con-bg p-2 text-[11.5px] shadow-lg"
        >
          {models.map((model) => (
            <li key={model} className="px-1 py-0.5 text-con-dim">
              {model}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
