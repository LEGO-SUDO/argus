// EmptyState — scope-keyed friendly empty state for each console tab.
//
// LLD frontend-web Phase 6 (Tasks 70-71). Pure render: a per-scope copy table,
// a deep link to `/chat` (so the user can produce real traffic), and a
// Generate-Samples CTA wired to `onGenerateSamples`.

'use client';

import Link from 'next/link';

export type EmptyStateScope = 'traces' | 'cost' | 'replay';

const COPY: Record<EmptyStateScope, { title: string; body: string }> = {
  traces: {
    title: 'No traces yet',
    body: 'Send a message in chat or generate sample inferences to see live traces here.',
  },
  cost: {
    title: 'No cost data yet',
    body: 'Once inferences run, their token spend rolls up here by conversation, provider, or model.',
  },
  replay: {
    title: 'Nothing to replay yet',
    body: 'Replay re-runs a past inference against a different provider or model. Generate some traffic first.',
  },
};

export type EmptyStateProps = {
  scope: EmptyStateScope;
  onGenerateSamples?: () => void;
};

export function EmptyState({ scope, onGenerateSamples }: EmptyStateProps) {
  const copy = COPY[scope];
  return (
    <div
      data-testid={`console-empty-state-${scope}`}
      role="status"
      className="flex flex-col items-center gap-3 rounded-md border border-dashed border-chat-rule bg-chat-panel px-6 py-12 text-center"
    >
      <h2 className="text-sm font-medium text-chat-ink">{copy.title}</h2>
      <p className="max-w-sm text-[13px] text-chat-ink-2">{copy.body}</p>
      <div className="flex items-center gap-2">
        <Link
          href="/chat"
          data-testid={`console-empty-state-${scope}-chat-link`}
          className="rounded-[6px] border border-chat-rule px-3 py-1.5 text-[12.5px] font-medium text-chat-ink hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          Go to chat
        </Link>
        {onGenerateSamples && (
          <button
            type="button"
            data-testid={`console-empty-state-${scope}-generate-cta`}
            aria-label="Generate sample inferences"
            onClick={onGenerateSamples}
            className="rounded-[6px] bg-chat-ink px-3 py-1.5 text-[12.5px] font-medium text-chat-bg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            Generate sample inferences
          </button>
        )}
      </div>
    </div>
  );
}
