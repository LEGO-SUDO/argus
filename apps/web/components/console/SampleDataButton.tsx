// SampleDataButton — "Generate sample inferences" control.
//
// LLD frontend-web Phase 6 (Tasks 74-77). Triggers POST /api/console/samples/
// generate, surfacing an interim "Generating…" then a count-aware "Generated N
// inferences" status inside an aria-live region. A failure surfaces inline and
// re-enables the button for retry. On success, `onGenerated(count)` lets the
// parent trigger a refetch.

'use client';

import { useState } from 'react';

import { generateSample } from '@/lib/console-api';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'done'; count: number }
  | { kind: 'error'; message: string };

export type SampleDataButtonProps = {
  /** Optional explicit sample count to request. */
  count?: number;
  /** Called with the generated count so the parent can refetch its slice. */
  onGenerated?: (count: number) => void;
};

export function SampleDataButton({ count, onGenerated }: SampleDataButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const generating = status.kind === 'generating';

  async function handleClick() {
    setStatus({ kind: 'generating' });
    try {
      const result = await generateSample(count !== undefined ? { count } : {});
      setStatus({ kind: 'done', count: result.count });
      onGenerated?.(result.count);
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate samples',
      });
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        data-testid="console-sample-data-button"
        aria-label="Generate sample inferences"
        disabled={generating}
        onClick={handleClick}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] border border-chat-rule px-3 py-[7px] text-[12.5px] font-medium text-chat-ink hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? 'Generating…' : 'Generate sample inferences'}
      </button>

      <span
        data-testid="console-sample-data-status"
        role="status"
        aria-live="polite"
        className="text-[12px] text-chat-ink-2"
      >
        {status.kind === 'generating' && 'Generating…'}
        {status.kind === 'done' && `Generated ${status.count} inferences`}
      </span>

      {status.kind === 'error' && (
        <span
          data-testid="console-sample-data-error"
          role="alert"
          className="text-[12px] text-err"
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
