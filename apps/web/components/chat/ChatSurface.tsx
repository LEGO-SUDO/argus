// ChatSurface — the stable host for MessageStream across `/chat` and
// `/chat/<id>` URLs.
//
// Bug fix: prior to this hoist, MessageStream was rendered by the page
// components — `app/chat/page.tsx` (conversationId=null) and
// `app/chat/[conversationId]/page.tsx` (UUID-from-URL). When the user sent
// the first message of a brand-new conversation, the server's `start` frame
// carried the freshly-minted id, the client updated the URL, and Next's
// route reconciliation eventually swapped which page component was mounted.
// That unmounted the original MessageStream (killing the in-flight WS) and
// mounted a fresh one — producing duplicate WS connections and the
// "WebSocket is closed before the connection is established" → user-visible
// "Connection issue (socket)" banner.
//
// Fix: host MessageStream in this client component, which is rendered by
// ChatShell (which itself is rendered by the chat layout). The layout is
// stable across both URL shapes, so the MessageStream never unmounts on
// the URL swap. We derive `conversationId` from `usePathname()` so the
// component is the single source of truth.
//
// Mount/remount policy:
//   - On the new-conversation → just-minted transition (URL change driven
//     by the WS start frame, target id is in `mintedIds`): KEEP the same
//     MessageStream mount. The live reducer state is the truth; we must
//     not blow it away. This is the regression we're fixing.
//   - On any other id change (user clicks a sidebar link, /chat → /chat/X,
//     or X → Y): remount via the key. The new MessageStream lazy-inits
//     its reducer from the fresh `initialMessages` we just fetched. This
//     mount churn is acceptable because there is no in-flight WS turn at
//     that boundary — the user is explicitly switching conversations.
'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MessageStream } from './MessageStream';
import {
  primeConversationHistoryCache,
  useConversationHistory,
} from '@/lib/use-conversation-history';

// Match `/chat/<uuid>` and capture the id. Anything else (including bare
// `/chat`) resolves to null — the new-conversation surface.
const CONV_PATH_RE = /^\/chat\/([0-9a-f-]{36})(?:\/|$)/i;

export function ChatSurface() {
  const pathname = usePathname();

  // Track conversation ids that this client minted locally (via the WS
  // start frame). The history-fetch hook skips these because the live
  // MessageStream state is already authoritative — refetching would
  // double-up the messages or briefly wipe them while loading lands.
  const [mintedIds, setMintedIds] = useState<Set<string>>(() => new Set());

  const conversationId = useMemo(() => {
    const match = pathname?.match(CONV_PATH_RE);
    return match ? (match[1] ?? null) : null;
  }, [pathname]);

  // ----- Mount-key policy. -----
  //
  // We need a key that is STABLE through the null → minted-uuid transition
  // (so MessageStream keeps its in-flight WS + reducer state) but CHANGES
  // when the user navigates to a different conversation (so the new one
  // lazy-inits its reducer with the freshly-fetched `initialMessages`).
  //
  // Strategy: a monotonic counter that bumps on every non-mint transition.
  // Using a counter (rather than the conversationId itself as the key)
  // avoids the collision where two distinct states map to the same key
  // value — e.g. user is on `/chat` (key=N), mints id-A (key stays N), then
  // clicks "New conversation" back to `/chat` (would-be key still N → no
  // remount → stale messages from id-A). The counter guarantees distinct
  // values across every user-driven navigation.
  const [mountKey, setMountKey] = useState<number>(0);
  const prevConvIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    if (prevConvIdRef.current === conversationId) return;
    const isMintedTransition =
      conversationId !== null && mintedIds.has(conversationId);
    if (!isMintedTransition) {
      setMountKey((k) => k + 1);
    }
    prevConvIdRef.current = conversationId;
    // mintedIds intentionally excluded — only the conversationId change
    // is the trigger; mintedIds is read for its current value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const history = useConversationHistory(conversationId, {
    skipFor: mintedIds,
  });

  // Callback handed to MessageStream — invoked when the WS start frame
  // hands us a freshly-minted conversation id. We mark the id as
  // locally-owned so the history hook doesn't try to fetch it, and prime
  // the cache so a later back-and-forth navigation finds an empty (but
  // valid) entry rather than triggering a fetch.
  const handleConversationMinted = useCallback((id: string) => {
    setMintedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    primeConversationHistoryCache(id, { messages: [], omittedCount: 0 });
  }, []);

  // Loading state on direct URL hit (refresh / paste-link) — the layout
  // mounts with the id already in the path and we need a beat to fetch
  // the messages. Acceptable per design (Phase A trade-off documented in
  // [conversationId]/page.tsx).
  if (history.status === 'loading') {
    return (
      <div
        data-testid="chat-surface-loading"
        role="status"
        aria-live="polite"
        className="flex h-full items-center justify-center text-sm text-chat-ink-2"
      >
        Loading conversation…
      </div>
    );
  }

  if (history.status === 'error') {
    return (
      <div
        role="alert"
        data-testid="chat-surface-error"
        className="m-6 max-w-md rounded-md border border-err/30 bg-err/5 p-4 text-sm text-chat-ink"
      >
        <p className="font-medium text-err">Couldn&apos;t load conversation</p>
        <p className="mt-1 text-chat-ink-2">{history.error.message}</p>
      </div>
    );
  }

  // `idle` (null conversationId) and `ready` both render MessageStream.
  // The key follows the policy above: stable across the null → minted
  // transition (so the WS stays alive) but distinct per
  // user-driven-navigation.
  const initialMessages =
    history.status === 'ready' ? history.messages : [];
  const omittedCount =
    history.status === 'ready' ? history.omittedCount : 0;

  return (
    <MessageStream
      key={mountKey}
      conversationId={conversationId}
      initialMessages={initialMessages}
      omittedCount={omittedCount}
      onConversationMinted={handleConversationMinted}
    />
  );
}
