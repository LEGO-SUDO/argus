// /chat — default new-conversation route slot.
//
// MessageStream is hoisted into the chat layout (via ChatShell → ChatSurface)
// so it survives the URL transition to `/chat/<minted-id>` that follows the
// first `start` frame of a brand-new conversation. See ChatSurface for the
// long form of the rationale.
//
// This page intentionally returns `null` — the layout owns the chat surface.
// We keep the file (rather than deleting the segment) because:
//   - Next.js needs a `page.tsx` to mark `/chat` as routable
//   - Future routes may want to slot a modal or overlay alongside the
//     always-mounted MessageStream via this `children` position
//   - The auth gate already lives in the layout; no need to duplicate it
//     here
import { redirect } from 'next/navigation';

import { getSessionUser } from '@/lib/server-session';

export default async function NewConversationPage() {
  // Layout-level gate is the primary check. We re-resolve here so a
  // request that reaches this route slot without a valid session is
  // bounced even if the layout is somehow bypassed (defense in depth —
  // server-side redirect, cheap, no extra fetch beyond the cached
  // session lookup).
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }
  return null;
}
