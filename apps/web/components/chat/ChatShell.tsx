// ChatShell — client wrapper that lays out the sidebar + topbar + main
// region for the chat surface.
//
// Why this exists as a client component (vs the layout doing it all
// server-side): the mobile-drawer sidebar needs a `useState` toggle and
// the topbar needs a hamburger button that's wired to that state. We
// could thread it through context, but a single thin wrapper here is
// simpler and keeps the layout server-component-friendly.
//
// On md+ the grid is `260px 1fr` matching the design's
// `grid-template-columns: 260px 1fr` (Phase A is desktop-targeted). Below
// md the sidebar collapses behind the hamburger toggle as a drawer.
//
// MessageStream hoist: ChatSurface (rendered in the main region below)
// owns the MessageStream and derives its conversationId from
// `usePathname()`. The page components under `app/chat/` are
// intentionally near-empty route slots — they handle the auth gate +
// server-side ownership check, but no longer mount MessageStream. This
// keeps the WS connection alive across the `/chat` → `/chat/<id>` URL
// transition that follows the first `start` frame of a new conversation.
'use client';

import { useState, useEffect } from 'react';
import type { ConversationDto } from '@argus/contracts';

import { ChatSidebar } from './ChatSidebar';
import { ChatSurface } from './ChatSurface';
import { ChatTopbar } from './ChatTopbar';

type ChatShellProps = {
  conversations: ConversationDto[];
  userEmail: string;
  /**
   * Page slot. Today the chat page components return `null` — we keep
   * the slot threaded through so future routes can render modals,
   * overlays, or auxiliary panels alongside the always-mounted
   * MessageStream without restructuring the shell.
   */
  children: React.ReactNode;
};

export function ChatShell({
  conversations,
  userEmail,
  children,
}: ChatShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer with Escape so the mobile UX matches a standard
  // modal/drawer pattern. The body-scroll-lock isn't needed because the
  // drawer covers the viewport and the underlying content can't scroll
  // behind it.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div
      data-testid="chat-shell"
      className="grid h-screen w-screen overflow-hidden bg-chat-bg text-chat-ink md:grid-cols-[260px_1fr]"
    >
      {/* Desktop sidebar — always-visible at md+. */}
      <div className="hidden md:block">
        <ChatSidebar conversations={conversations} userEmail={userEmail} />
      </div>

      {/* Mobile sidebar drawer — covers the viewport from the left when
       *  open. The backdrop captures clicks to close. */}
      {drawerOpen ? (
        <div
          data-testid="chat-mobile-drawer"
          className="fixed inset-0 z-40 md:hidden"
        >
          <button
            type="button"
            data-testid="chat-mobile-drawer-backdrop"
            aria-label="Close sidebar"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-chat-ink/40"
          />
          <div className="relative h-full w-[280px] max-w-[85vw] border-r border-chat-rule bg-chat-panel shadow-xl">
            <ChatSidebar
              conversations={conversations}
              userEmail={userEmail}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <main className="flex h-screen min-w-0 flex-col overflow-hidden">
        <ChatTopbar
          conversations={conversations}
          onMobileMenuClick={() => setDrawerOpen(true)}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <ChatSurface />
          {/* Page slot — empty today; reserved for route-specific
           *  overlays (modals, side-panels) that should render alongside
           *  the always-mounted MessageStream. */}
          {children}
        </div>
      </main>
    </div>
  );
}
