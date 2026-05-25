// ClearModal — type-CLEAR-to-confirm destructive reset of the user's console
// data.
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses console
// CSS tokens (--con-bg, --con-panel, --con-rule, --con-text, etc.) for a
// consistent dark-surface modal. All existing data-testids, aria-modal,
// aria-labelledby, confirmation gating, in-flight status, and error handling
// are fully preserved.

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
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)',
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--con-bg)',
          border: '1px solid var(--con-rule)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 24px 48px -12px rgba(0,0,0,0.6)',
          fontFamily: 'var(--font-geist), ui-sans-serif, sans-serif',
        }}
      >
        <h2
          id="console-clear-modal-title"
          style={{
            margin: '0 0 4px',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--con-text)',
          }}
        >
          Clear all console data?
        </h2>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 12.5,
            color: 'var(--con-dim)',
            lineHeight: 1.5,
          }}
        >
          This permanently deletes your inferences, traces, and sample data. This cannot be undone.
        </p>

        {preview === null ? (
          <div
            data-testid="console-clear-modal-skeleton"
            aria-hidden="true"
            style={{
              marginBottom: 16,
              height: 64,
              borderRadius: 5,
              background: 'var(--con-panel)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        ) : (
          <dl
            data-testid="console-clear-modal-breakdown"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '6px 16px',
              margin: '0 0 16px',
              padding: '10px 12px',
              background: 'var(--con-panel)',
              border: '1px solid var(--con-rule)',
              borderRadius: 5,
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 12,
            }}
          >
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--con-text)' }}>
              <dt>Total</dt>
              <dd data-testid="console-clear-modal-count-total" style={{ margin: 0 }}>{preview.total}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--con-dim)' }}>
              <dt>Chat</dt>
              <dd data-testid="console-clear-modal-count-chat" style={{ margin: 0 }}>{preview.chat}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--con-dim)' }}>
              <dt>Replay</dt>
              <dd data-testid="console-clear-modal-count-replay" style={{ margin: 0 }}>{preview.replay}</dd>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--con-dim)' }}>
              <dt>Sample</dt>
              <dd data-testid="console-clear-modal-count-sample" style={{ margin: 0 }}>{preview.sample}</dd>
            </div>
          </dl>
        )}

        <label
          htmlFor="console-clear-confirm-input"
          style={{ display: 'block', fontSize: 12, color: 'var(--con-dim)', marginBottom: 4 }}
        >
          Type{' '}
          <span style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontWeight: 600, color: 'var(--con-text)' }}>
            CLEAR
          </span>{' '}
          to confirm
        </label>
        <input
          id="console-clear-confirm-input"
          ref={inputRef}
          data-testid="console-clear-modal-input"
          aria-label="Type CLEAR to confirm"
          value={confirmText}
          disabled={clearing}
          onChange={(e) => setConfirmText(e.target.value)}
          style={{
            display: 'block',
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--con-bg)',
            border: '1px solid var(--con-rule)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12.5,
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            color: 'var(--con-text)',
            outline: 'none',
            marginBottom: 4,
            opacity: clearing ? 0.6 : undefined,
          }}
        />

        {clearing && (
          <p
            data-testid="console-clear-modal-status"
            role="status"
            aria-live="polite"
            style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--con-dim)' }}
          >
            Aborting active operations…
          </p>
        )}
        {phase === 'error' && (
          <p
            data-testid="console-clear-modal-error"
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--err)' }}
          >
            {errorMessage}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            data-testid="console-clear-modal-cancel"
            aria-label="Cancel"
            onClick={onClose}
            className="filter-chip"
            style={{ padding: '6px 14px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="console-clear-modal-confirm"
            aria-label="Clear all data"
            disabled={!confirmed || clearing}
            onClick={handleConfirm}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 14px',
              borderRadius: 4,
              background: 'var(--err)',
              color: 'oklch(0.98 0.005 0)',
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: !confirmed || clearing ? 'not-allowed' : 'pointer',
              opacity: !confirmed || clearing ? 0.4 : undefined,
              border: 'none',
            }}
          >
            {clearing ? 'Clearing…' : 'Clear all data'}
          </button>
        </div>
      </div>
    </div>
  );
}
