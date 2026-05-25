// EmptyState — scope-keyed friendly empty state for each console tab.
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses .empty /
// .card / .glyph / .cta from console.css. The Icon glyph is chosen per scope.
// All existing data-testids, props, and behavior are fully preserved.

'use client';

import Link from 'next/link';

import { Icon, type IconName } from './Icon';

export type EmptyStateScope = 'traces' | 'cost' | 'replay';

const COPY: Record<EmptyStateScope, { title: string; body: string; icon: IconName }> = {
  traces: {
    title: 'No traces yet',
    body: 'Send a message in chat or generate sample inferences to see live traces here.',
    icon: 'list',
  },
  cost: {
    title: 'No cost data yet',
    body: 'Once inferences run, their token spend rolls up here by conversation, provider, or model.',
    icon: 'dollar',
  },
  replay: {
    title: 'Nothing to replay yet',
    body: 'Replay re-runs a past inference against a different provider or model. Generate some traffic first.',
    icon: 'replay',
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
      className="empty"
    >
      <div className="card">
        <div className="glyph" aria-hidden="true">
          <Icon name={copy.icon} size={16} />
        </div>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <Link
            href="/chat"
            data-testid={`console-empty-state-${scope}-chat-link`}
            aria-label="Go to chat"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '7px 14px',
              borderRadius: 4,
              border: '1px solid var(--con-rule)',
              background: 'var(--con-panel)',
              color: 'var(--con-dim)',
              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              fontSize: 11.5,
            }}
          >
            Go to chat
          </Link>
          {onGenerateSamples && (
            <button
              type="button"
              data-testid={`console-empty-state-${scope}-generate-cta`}
              aria-label="Generate sample inferences"
              onClick={onGenerateSamples}
              className="cta"
            >
              Generate sample inferences
              <Icon name="arrow-right" size={11} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
