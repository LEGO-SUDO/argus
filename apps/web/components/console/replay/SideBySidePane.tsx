// SideBySidePane — original vs replay comparison (LLD Phase 9 / Task 177).
//
// Two-column layout with a per-pane expand control. In `raw` mode the original
// and replay outputs sit side by side; in `diff` mode the precomputed
// word-level diff is rendered via DiffRenderer (HLD D4 — server-computed diff).

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { DiffChange } from '@argus/contracts';
import { DiffRenderer } from './DiffRenderer';
import { PaneExpandControl } from './PaneExpandControl';
import type { DiffViewMode } from './DiffToggle';

export type SideBySidePaneProps = {
  original: ReactNode;
  replay: ReactNode;
  diff: DiffChange[];
  mode: DiffViewMode;
};

export function SideBySidePane({ original, replay, diff, mode }: SideBySidePaneProps) {
  const [expandedPane, setExpandedPane] = useState<null | 'original' | 'replay'>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Move focus into the expanded overlay so Escape / Tab are scoped to it.
  useEffect(() => {
    if (expandedPane) overlayRef.current?.focus();
  }, [expandedPane]);

  return (
    <div data-testid="console-replay-side-by-side" className="rounded-md border border-chat-rule">
      {mode === 'diff' ? (
        <div data-testid="console-replay-diff-view" className="p-3">
          <DiffRenderer changes={diff} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-px bg-chat-rule md:grid-cols-2">
          <section
            data-testid="console-replay-pane-original"
            className="flex flex-col gap-1 bg-chat-bg p-3"
          >
            <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-chat-ink-3">
              Original
              <PaneExpandControl label="original" onExpand={() => setExpandedPane('original')} />
            </header>
            <div className="whitespace-pre-wrap break-words text-[12.5px] text-chat-ink">
              {original}
            </div>
          </section>
          <section
            data-testid="console-replay-pane-replay"
            className="flex flex-col gap-1 bg-chat-bg p-3"
          >
            <header className="flex items-center justify-between text-[11px] uppercase tracking-wide text-chat-ink-3">
              Replay
              <PaneExpandControl label="replay" onExpand={() => setExpandedPane('replay')} />
            </header>
            <div className="whitespace-pre-wrap break-words text-[12.5px] text-chat-ink">
              {replay}
            </div>
          </section>
        </div>
      )}

      {expandedPane && (
        <div
          ref={overlayRef}
          tabIndex={-1}
          data-testid="console-replay-pane-expanded"
          role="dialog"
          aria-modal="true"
          aria-label={`${expandedPane} pane (expanded)`}
          className="fixed inset-0 z-50 overflow-auto bg-black/50 p-6 focus:outline-none"
          onClick={() => setExpandedPane(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setExpandedPane(null);
          }}
        >
          <div
            className="mx-auto max-w-3xl rounded-md bg-chat-bg p-5 text-[13px] text-chat-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                data-testid="console-replay-pane-expanded-close"
                aria-label="Close expanded pane"
                onClick={() => setExpandedPane(null)}
                className="rounded-[6px] border border-chat-rule px-2.5 py-1 text-[12px] font-medium text-chat-ink-2 hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
              >
                Close
              </button>
            </div>
            <div className="whitespace-pre-wrap break-words">
              {expandedPane === 'original' ? original : replay}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
