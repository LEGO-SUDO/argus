// /chat/[conversationId] — resume route slot.
//
// MessageStream is hoisted into the chat layout (via ChatShell →
// ChatSurface). This page intentionally returns `null` — the chat surface
// is rendered by the layout, and history hydration happens client-side via
// `useConversationHistory` (called from ChatSurface).
//
// Why this page still exists:
//   1. Next.js needs a `page.tsx` for the dynamic segment to match.
//   2. Server-side ownership check — we call `getMessages` to verify the
//      current user owns this conversation. On 404 we trigger Next's
//      `notFound()` so the route renders `not-found.tsx` rather than
//      handing the unauthorized id to the client. This stays on the
//      server because the api enforces user-scoping there, and we want
//      the bounce to happen before the client even renders the chat
//      shell with someone else's conversation in the URL.
//   3. Auth gate redirect — the layout does this too, but doing it here
//      keeps the route self-contained.
//
// History hydration trade-off (client-side fetch with loading flicker):
//   - Chose this over server-side hydration via a hidden injection
//     mechanism because the simpler approach is correct enough for
//     Phase A. On a direct URL hit / refresh, the user sees a brief
//     "Loading conversation…" indicator in the chat area while
//     `useConversationHistory` fetches the messages. The shell + sidebar
//     + topbar all render immediately from layout-level data, so the
//     perceived flicker is confined to the message pane.
//   - The cleaner-but-more-machinery alternative would be to inject the
//     pre-fetched messages here via a context provider or a tiny
//     `<MessageStreamHydrate>` client component that primes a shared
//     store. That's reasonable to revisit in Phase B when surface
//     polish becomes the priority.

import { notFound, redirect } from 'next/navigation';

import { ApiError } from '@/lib/auth-fetch';
import { getMessages } from '@/lib/conversations-api';
import { getSessionUser, sessionCookieHeader } from '@/lib/server-session';

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const { conversationId } = await params;

  // Ownership probe — we don't use the result here (the layout's
  // client-side fetch hook owns hydration), but a 404 from the api means
  // the current user doesn't own this conversation and we should
  // notFound() before rendering anything. The probe is a single cheap
  // GET; if it succeeds we discard the body.
  try {
    await getMessages(conversationId, await sessionCookieHeader());
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  return null;
}
