// ChatTopbar — sticky bar above the chat scroll region with the
// conversation title on the left and a forward-compat slot for the Phase B
// surface-switch pill on the right.
//
// Mirrors `.chat-topbar` + `.conv-title` in `docs/design/project/styles.css`
// (lines 393-413) and the `<header className="chat-topbar">` block in
// `docs/design/project/chat.jsx`.
//
// Phase B will mount a `<SurfaceSwitch />` into the right slot (chat /
// console pill). For Phase A we leave the slot empty (placeholder div) so
// the topbar layout matches the design proportions today and the switch can
// drop in without touching the layout file.
'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import type { ConversationDto } from '@argus/contracts';

import { SurfaceSwitch } from './SurfaceSwitch';

type ChatTopbarProps = {
  conversations: ConversationDto[];
  /** Mobile-drawer toggle (only rendered below md). The parent owns the
   *  drawer open state; this is just the trigger. */
  onMobileMenuClick?: () => void;
};

export function ChatTopbar({
  conversations,
  onMobileMenuClick,
}: ChatTopbarProps) {
  const pathname = usePathname();

  // Resolve the active conversation title from the path. We do this here
  // (vs threading title through props) because the topbar is rendered in
  // the layout while the conversation list is the source of truth for
  // titles — passing the whole list keeps a single render path.
  const title = useMemo(() => {
    const match = pathname?.match(/^\/chat\/([0-9a-f-]{36})/i);
    if (!match) return null;
    const id = match[1];
    const conv = conversations.find((c) => c.id === id);
    return conv?.title ?? null;
  }, [pathname, conversations]);

  return (
    <header
      data-testid="chat-topbar"
      className="sticky top-0 z-[5] flex min-h-[52px] items-center justify-between border-b border-chat-rule-2 bg-chat-bg px-4 py-3.5 md:px-7"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Mobile-only hamburger. Hidden on md+ where the sidebar is
         *  always-visible. */}
        {onMobileMenuClick ? (
          <button
            type="button"
            data-testid="chat-topbar-mobile-menu"
            aria-label="Open sidebar"
            onClick={onMobileMenuClick}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] text-chat-ink-2 transition-colors hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2 4h12M2 8h12M2 12h12"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
        <div
          data-testid="chat-topbar-title"
          className="min-w-0 truncate text-[13.5px] text-chat-ink-2"
        >
          {title ? (
            <>
              <span className="text-chat-ink-2">Conversation: </span>
              <b className="font-medium text-chat-ink">{title}</b>
            </>
          ) : (
            <span className="text-chat-ink-2">New conversation</span>
          )}
        </div>
      </div>

      {/* Surface-switch (chat / console pill) — the way to reach /console. */}
      <div
        data-testid="chat-topbar-surface-switch-slot"
        className="flex items-center gap-2"
      >
        <SurfaceSwitch />
      </div>
    </header>
  );
}
