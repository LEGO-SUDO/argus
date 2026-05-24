// /chat layout — auth-gated shell with sidebar + topbar.
//
// LLD Task 50. Server component that:
//   1. Resolves the session via `server-session.ts`; redirects to /login if
//      unauthenticated.
//   2. Server-fetches the user-scoped conversation list with the incoming
//      session cookie forwarded.
//   3. Delegates layout to <ChatShell> (client component) which owns the
//      mobile-drawer state, sidebar grouping, and topbar.
//
// The list is hydrated at request time so the client component doesn't have
// to round-trip on first paint. Subsequent CRUD ops can revalidate via
// `router.refresh()` from client actions.
//
// Responsive note: Phase A targets desktop — the design intent is a 260px
// sidebar + a 720px-wide centered chat column. Below the md breakpoint the
// sidebar collapses behind a hamburger button (see ChatShell) so the
// surface stays usable on phones/tablets without redesigning the layout.

import { redirect } from 'next/navigation';

import { ChatShell } from '@/components/chat/ChatShell';
import { listConversations } from '@/lib/conversations-api';
import { getSessionUser, sessionCookieHeader } from '@/lib/server-session';
import type { ConversationDto } from '@argus/contracts';

type ChatLayoutProps = {
  children: React.ReactNode;
};

export default async function ChatLayout({ children }: ChatLayoutProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  // Best-effort fetch — render the layout with an empty list if the api
  // hiccups so the chat surface is still usable.
  let conversations: ConversationDto[] = [];
  try {
    conversations = await listConversations(await sessionCookieHeader());
  } catch {
    conversations = [];
  }

  // `user.email` is optional on the contract (api currently always returns
  // it, but the type allows undefined). Fall back to a stable string so the
  // avatar monogram has something to derive from.
  const email = user.email ?? 'unknown';

  return (
    <ChatShell conversations={conversations} userEmail={email}>
      {children}
    </ChatShell>
  );
}
