// SampleDataButton — "Generate sample inferences" control.
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses
// .filter-chip styling to fit the console topbar. All existing data-testids,
// aria-live, props, state machine, and behavior are fully preserved.

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
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        data-testid="console-sample-data-button"
        aria-label="Generate sample inferences"
        disabled={generating}
        onClick={handleClick}
        className="filter-chip"
        style={{ opacity: generating ? 0.5 : undefined, cursor: generating ? 'not-allowed' : undefined }}
      >
        {generating ? 'Generating…' : 'Generate samples'}
      </button>

      <span
        data-testid="console-sample-data-status"
        role="status"
        aria-live="polite"
        style={{
          fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
          fontSize: 11,
          color: 'var(--con-dim)',
        }}
      >
        {status.kind === 'generating' && 'Generating…'}
        {status.kind === 'done' && `Generated ${status.count} inferences`}
      </span>

      {status.kind === 'error' && (
        <span
          data-testid="console-sample-data-error"
          role="alert"
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 11,
            color: 'var(--err)',
          }}
        >
          {status.message}
        </span>
      )}
    </div>
  );
}
