// ConversationList — user-scoped sidebar list with Today / Yesterday /
// Earlier grouping.
//
// Mirrors `.chat-side .list` in `docs/design/project/styles.css` and the
// `ChatSidebar` block in `docs/design/project/chat.jsx`. The conversation
// rows themselves are 13px, line-height 1.35, truncated, and the active row
// uses `bg-chat-hover` (NOT `bg-acc-soft` — accent-tinting is reserved for
// the brand mark dot and the auth switch-link underline).
//
// Client component because it needs to know which row is active (the
// highlight is route-derived via `usePathname` upstream and the active id is
// plumbed in as a prop). The list itself is server-fetched in
// `app/chat/layout.tsx` so the initial render is hydrated, not lazy.
'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ConversationDto } from '@argus/contracts';

type ConversationListProps = {
  conversations: ConversationDto[];
  /** Current conversation id from the URL, or null on /chat (new conversation). */
  activeId: string | null;
  /** Optional handler called when an item is picked — used by the mobile
   *  drawer to close itself after navigation. The Link's href still drives
   *  routing; this is purely a side-effect hook. */
  onPick?: (id: string) => void;
};

type Bucket = 'today' | 'yesterday' | 'earlier';

type GroupedConversations = {
  today: ConversationDto[];
  yesterday: ConversationDto[];
  earlier: ConversationDto[];
};

/**
 * Bucket a conversation into today/yesterday/earlier.
 *
 * Matches the heuristic in `docs/design/project/chat.jsx` (lines 45-55):
 *   - < 18h old  → today
 *   - < 42h old  → yesterday
 *   - otherwise  → earlier
 *
 * We use `lastMessageAt` when it differs from `createdAt` (matches a
 * "most-recent-activity" sort intuition); otherwise fall back to
 * `createdAt`. Both are ISO strings on the contract DTO.
 */
function bucketFor(conv: ConversationDto, now: number): Bucket {
  const ts = Date.parse(conv.lastMessageAt ?? conv.createdAt);
  const age = now - (Number.isFinite(ts) ? ts : now);
  const H = 1000 * 60 * 60;
  if (age < 18 * H) return 'today';
  if (age < 42 * H) return 'yesterday';
  return 'earlier';
}

function groupConversations(
  conversations: ConversationDto[],
  now: number,
): GroupedConversations {
  const out: GroupedConversations = { today: [], yesterday: [], earlier: [] };
  for (const c of conversations) {
    out[bucketFor(c, now)].push(c);
  }
  return out;
}

export function ConversationList({
  conversations,
  activeId,
  onPick,
}: ConversationListProps) {
  // Memoize on the conversations reference; the parent re-renders if the
  // server returns a new list. `Date.now()` is sampled inside the memo so it
  // doesn't churn on unrelated re-renders.
  const grouped = useMemo(
    () => groupConversations(conversations, Date.now()),
    [conversations],
  );

  if (conversations.length === 0) {
    return (
      <div
        data-testid="conversation-list-empty"
        className="px-3 py-4 text-[13px] leading-[1.5] text-chat-ink-2"
      >
        <p className="m-0">No conversations yet — your threads will appear here.</p>
        <Link
          href="/chat"
          data-testid="conversation-list-empty-cta"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-chat-rule px-3 py-[6px] text-[13px] font-medium text-chat-ink hover:bg-chat-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          Start a new chat
        </Link>
      </div>
    );
  }

  return (
    <nav
      aria-label="Conversations"
      data-testid="conversation-list"
      className="flex flex-col px-2 pb-3 pt-1.5"
    >
      <ConversationGroup
        label="Today"
        bucket="today"
        items={grouped.today}
        activeId={activeId}
        onPick={onPick}
      />
      <ConversationGroup
        label="Yesterday"
        bucket="yesterday"
        items={grouped.yesterday}
        activeId={activeId}
        onPick={onPick}
      />
      <ConversationGroup
        label="Earlier"
        bucket="earlier"
        items={grouped.earlier}
        activeId={activeId}
        onPick={onPick}
      />
    </nav>
  );
}

type ConversationGroupProps = {
  label: string;
  bucket: Bucket;
  items: ConversationDto[];
  activeId: string | null;
  onPick?: (id: string) => void;
};

function ConversationGroup({
  label,
  bucket,
  items,
  activeId,
  onPick,
}: ConversationGroupProps) {
  if (items.length === 0) return null;
  return (
    <div data-testid={`conversation-group-${bucket}`}>
      <div
        data-testid={`conversation-group-label-${bucket}`}
        className="px-2.5 pb-1.5 pt-3.5 text-[10.5px] uppercase tracking-[0.06em] text-chat-ink-3"
      >
        {label}
      </div>
      {items.map((c) => {
        const isActive = c.id === activeId;
        return (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            data-testid={`conversation-list-item-${c.id}`}
            {...(isActive ? { 'aria-current': 'page' as const } : {})}
            onClick={onPick ? () => onPick(c.id) : undefined}
            className={
              'block w-full truncate rounded-[5px] px-2.5 py-2 text-[13px] leading-[1.35] ' +
              'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ' +
              (isActive
                ? 'bg-chat-hover font-medium text-chat-ink'
                : 'text-chat-ink-2 hover:bg-chat-hover hover:text-chat-ink')
            }
          >
            {c.title}
          </Link>
        );
      })}
    </div>
  );
}
