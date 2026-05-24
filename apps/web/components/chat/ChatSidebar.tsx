// ChatSidebar — full 260px chat-side column with brand mark head,
// persistent "+ New conversation" button (always visible, even when
// conversations exist), grouped conversation list, and user-chip footer.
//
// Mirrors `.chat-side` block in `docs/design/project/styles.css`
// (lines 275-391) and the `ChatSidebar` JSX in `docs/design/project/chat.jsx`.
//
// Client component because:
//   - It reads `usePathname` to derive `activeId` for the list
//   - It owns the mobile-drawer close handler
//   - It supplies the New-conversation button (a `<Link>` to /chat)
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConversationDto } from '@argus/contracts';

import { Wordmark } from '@/components/brand/Wordmark';
import { ConversationList } from './ConversationList';
import { UserChip } from './UserChip';

type ChatSidebarProps = {
  conversations: ConversationDto[];
  userEmail: string;
  /** Called on any nav click — used by the mobile drawer to close itself.
   *  No-op on desktop. */
  onNavigate?: () => void;
};

export function ChatSidebar({
  conversations,
  userEmail,
  onNavigate,
}: ChatSidebarProps) {
  const pathname = usePathname();
  // Match `/chat/<uuid>` only — on /chat the activeId is null
  // (new-conversation surface).
  const match = pathname?.match(/^\/chat\/([0-9a-f-]{36})/i);
  const activeId = match ? (match[1] ?? null) : null;

  return (
    <aside
      data-testid="chat-sidebar"
      aria-label="Sidebar"
      className="flex h-full w-full flex-col bg-chat-panel md:w-[260px] md:border-r md:border-chat-rule"
    >
      <div data-testid="chat-sidebar-head" className="flex items-center justify-between px-[18px] pb-3.5 pt-5">
        <Wordmark />
      </div>

      <Link
        href="/chat"
        data-testid="chat-new-conversation"
        aria-label="New conversation"
        onClick={onNavigate}
        className="mx-3 mb-2 flex min-h-11 items-center justify-between gap-2 whitespace-nowrap rounded-[6px] border border-chat-rule bg-chat-bg px-[11px] py-[9px] text-[13px] text-chat-ink transition-colors hover:bg-[oklch(0.98_0.006_80)] focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
      >
        <span className="inline-flex items-center gap-2">
          {/* Plus icon — matches `Icon name="plus"` in the design source. */}
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <path
              d="M6.5 2v9M2 6.5h9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          New conversation
        </span>
        <kbd>⌘N</kbd>
      </Link>

      <div className="flex-1 overflow-y-auto" data-testid="chat-sidebar-list-scroll">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onPick={onNavigate ? () => onNavigate() : undefined}
        />
      </div>

      <UserChip email={userEmail} />
    </aside>
  );
}
