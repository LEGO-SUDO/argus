// DiffRenderer — renders a precomputed word-level diff payload (LLD Tasks
// 160-163). Per HLD D4 the diff is computed server-side and arrives via
// ReplayRunResponse.diff; this component is a pure RENDERER, not a computer
// (no jsdiff dependency on the client). An empty payload renders an empty
// container without crashing.

'use client';

import type { DiffChange } from '@argus/contracts';

export type DiffRendererProps = {
  changes: DiffChange[];
};

function variantOf(change: DiffChange): 'added' | 'removed' | 'unchanged' {
  if (change.added) return 'added';
  if (change.removed) return 'removed';
  return 'unchanged';
}

const CLASS: Record<string, string> = {
  added: 'font-semibold text-ok underline decoration-dotted',
  removed: 'text-err line-through',
  unchanged: 'text-con-text',
};

export function DiffRenderer({ changes }: DiffRendererProps) {
  return (
    <div
      data-testid="console-diff-renderer"
      className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6]"
    >
      {changes.map((change, index) => {
        const variant = variantOf(change);
        return (
          <span
            key={index}
            data-diff={variant}
            aria-label={variant === 'unchanged' ? undefined : variant}
            className={CLASS[variant]}
          >
            {change.value}
          </span>
        );
      })}
    </div>
  );
}
