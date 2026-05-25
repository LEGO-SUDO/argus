// ClearModal — type-CLEAR-to-confirm destructive reset of the user's console
// data.
//
// LLD frontend-web Phase 6 (Tasks 78-87). On mount it fetches the preview
// breakdown (total + per-kind counts) and shows a skeleton until it resolves.
// The destructive button is gated on the input strictly equalling 'CLEAR'.
// While the POST is in flight an "Aborting active operations…" status shows;
// on success it fires onCleared + onClose. Cancel always closes without
// executing. A failed execute surfaces inline and stays retryable (onCleared
// is never called on failure).

'use client';

import { useEffect, useRef, useState } from 'react';

import { previewClear, executeClear } from '@/lib/console-api';
import type { ClearPreviewResponse } from '@argus/contracts';

const CONFIRM_TOKEN = 'CLEAR';

type Phase = 'idle' | 'clearing' | 'error';

export type ClearModalProps = {
  onClose: () => void;
  onCleared?: () => void;
};

export function ClearModal({ onClose, onCleared }: ClearModalProps) {
  const [preview, setPreview] = useState<ClearPreviewResponse | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const mountedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    // Move focus into the dialog on open (a11y: aria-modal must take focus).
    inputRef.current?.focus();
    void (async () => {
      try {
        const result = await previewClear();
        if (mountedRef.current) setPreview(result);
      } catch {
        // Preview is best-effort; the user can still confirm. Leave skeleton.
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const confirmed = confirmText === CONFIRM_TOKEN;
  const clearing = phase === 'clearing';

  async function handleConfirm() {
    if (!confirmed || clearing) return;
    setPhase('clearing');
    setErrorMessage('');
    try {
      await executeClear();
      if (!mountedRef.current) return;
      onCleared?.();
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to clear data');
    }
  }

  return (
    <div
      data-testid="console-clear-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="console-clear-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-chat-rule bg-chat-bg p-5 shadow-xl">
        <h2 id="console-clear-modal-title" className="text-sm font-semibold text-chat-ink">
          Clear all console data?
        </h2>
        <p className="mt-1 text-[13px] text-chat-ink-2">
          This permanently deletes your inferences, traces, and sample data. This cannot be
          undone.
        </p>

        {preview === null ? (
          <div
            data-testid="console-clear-modal-skeleton"
            aria-hidden="true"
            className="mt-4 h-16 animate-pulse rounded-md bg-chat-panel"
          />
        ) : (
          <dl
            data-testid="console-clear-modal-breakdown"
            className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-chat-panel p-3 text-[12.5px]"
          >
            <div className="col-span-2 flex justify-between font-medium text-chat-ink">
              <dt>Total</dt>
              <dd data-testid="console-clear-modal-count-total">{preview.total}</dd>
            </div>
            <div className="flex justify-between text-chat-ink-2">
              <dt>Chat</dt>
              <dd data-testid="console-clear-modal-count-chat">{preview.chat}</dd>
            </div>
            <div className="flex justify-between text-chat-ink-2">
              <dt>Replay</dt>
              <dd data-testid="console-clear-modal-count-replay">{preview.replay}</dd>
            </div>
            <div className="flex justify-between text-chat-ink-2">
              <dt>Sample</dt>
              <dd data-testid="console-clear-modal-count-sample">{preview.sample}</dd>
            </div>
          </dl>
        )}

        <label htmlFor="console-clear-confirm-input" className="mt-4 block text-[12.5px] text-chat-ink-2">
          Type <span className="font-mono font-semibold text-chat-ink">CLEAR</span> to confirm
        </label>
        <input
          id="console-clear-confirm-input"
          ref={inputRef}
          data-testid="console-clear-modal-input"
          aria-label="Type CLEAR to confirm"
          value={confirmText}
          disabled={clearing}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-1 w-full rounded-[6px] border border-chat-rule bg-chat-bg px-2.5 py-1.5 text-[13px] text-chat-ink outline-none focus:border-acc focus-visible:ring-2 focus-visible:ring-acc disabled:opacity-60"
        />

        {clearing && (
          <p
            data-testid="console-clear-modal-status"
            role="status"
            aria-live="polite"
            className="mt-3 text-[12.5px] text-chat-ink-2"
          >
            Aborting active operations…
          </p>
        )}
        {phase === 'error' && (
          <p
            data-testid="console-clear-modal-error"
            role="alert"
            className="mt-3 text-[12.5px] text-err"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="console-clear-modal-cancel"
            aria-label="Cancel"
            onClick={onClose}
            className="min-h-9 rounded-[6px] border border-chat-rule px-3 py-1.5 text-[12.5px] font-medium text-chat-ink hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="console-clear-modal-confirm"
            aria-label="Clear all data"
            disabled={!confirmed || clearing}
            onClick={handleConfirm}
            className="min-h-9 rounded-[6px] bg-err px-3 py-1.5 text-[12.5px] font-medium text-chat-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40"
          >
            {clearing ? 'Clearing…' : 'Clear all data'}
          </button>
        </div>
      </div>
    </div>
  );
}
