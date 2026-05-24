// useConversationHistory — client-side history fetch hook for the chat
// surface.
//
// Bug fix follow-up: `MessageStream` is now hoisted into the chat layout (via
// `ChatSurface`) so it survives the URL transition from `/chat` → `/chat/<id>`
// without remounting. That means history hydration moved from the server
// component (`app/chat/[conversationId]/page.tsx`) to the client.
//
// On a direct URL hit (refresh / paste-link), the layout mounts with the
// conversationId already in the path. This hook fetches the messages and
// returns them so ChatSurface can pass them as `initialMessages` to a
// freshly-keyed MessageStream.
//
// On a same-mount navigation (clicking a sidebar item, or just-minted
// conversation from a start frame), the caller decides whether to call this
// hook for the new id — for the just-minted case the caller skips the fetch
// because the messages are already in the live MessageStream state.
//
// We intentionally cache the result by conversationId in module scope so
// back-and-forth nav doesn't refetch. Cache entries are tiny (a snapshot of
// historic messages, not live state) — fine for a single-page session. A
// page refresh clears it.

'use client';

import { useEffect, useRef, useState } from 'react';

import { ApiError, authFetch } from './auth-fetch';
import type { Message } from './message-stream-reducer';
import type { MessageDto, MessageListResponse } from '@argus/contracts';

// Browser-only fetch for message history. We call `authFetch` directly
// (rather than the shared `getMessages` in `conversations-api.ts`) so this
// module stays free of the `server-only` import that `conversations-api`
// pulls in via `serverApiFetch`. Importing the shared helper from a client
// component breaks the Next.js build with:
//   "You're importing a component that needs 'server-only'"
// even when the browser branch never reaches the server-only code path —
// Webpack tracks the static import graph, not the runtime branch.
async function fetchMessagesFromBrowser(
  conversationId: string,
): Promise<{ messages: MessageDto[]; omittedCount: number }> {
  const res = await authFetch<MessageListResponse>(
    `/api/conversations/${conversationId}/messages`,
    { method: 'GET' },
  );
  return {
    messages: res.messages,
    omittedCount: res.omittedCount ?? 0,
  };
}

type HistorySnapshot = {
  messages: Message[];
  omittedCount: number;
};

// Module-level cache. Lives for the lifetime of the SPA session.
const cache = new Map<string, HistorySnapshot>();

export type ConversationHistoryState =
  | { status: 'idle' }
  | { status: 'loading'; conversationId: string }
  | {
      status: 'ready';
      conversationId: string;
      messages: Message[];
      omittedCount: number;
    }
  | { status: 'error'; conversationId: string; error: Error };

export type UseConversationHistoryOptions = {
  /**
   * Conversation ids that the caller has already populated locally (e.g.
   * a just-minted conversation whose messages are already in MessageStream
   * state). When the active id is in this set we skip the fetch and emit
   * an empty `ready` snapshot — the caller is expected to ignore it
   * because the live state is already authoritative.
   */
  skipFor?: ReadonlySet<string>;
};

/**
 * Resolve message history for a conversation id (or `null` for the
 * new-conversation surface).
 *
 * Returns a discriminated state with `idle` (null id) / `loading` /
 * `ready` (with messages + omittedCount) / `error`. Cached results return
 * `ready` synchronously on subsequent calls.
 */
export function useConversationHistory(
  conversationId: string | null,
  options: UseConversationHistoryOptions = {},
): ConversationHistoryState {
  // Stable handle to skipFor so the effect doesn't re-run when the parent
  // passes a fresh Set instance each render.
  const skipForRef = useRef(options.skipFor);
  skipForRef.current = options.skipFor;

  const [state, setState] = useState<ConversationHistoryState>(() => {
    if (!conversationId) return { status: 'idle' };
    const hit = cache.get(conversationId);
    if (hit) {
      return {
        status: 'ready',
        conversationId,
        messages: hit.messages,
        omittedCount: hit.omittedCount,
      };
    }
    if (skipForRef.current?.has(conversationId)) {
      return {
        status: 'ready',
        conversationId,
        messages: [],
        omittedCount: 0,
      };
    }
    return { status: 'loading', conversationId };
  });

  useEffect(() => {
    if (!conversationId) {
      setState({ status: 'idle' });
      return;
    }

    // Just-minted conversation — caller owns the live state, no fetch.
    if (skipForRef.current?.has(conversationId)) {
      setState({
        status: 'ready',
        conversationId,
        messages: [],
        omittedCount: 0,
      });
      return;
    }

    // Cache hit — synchronously return.
    const hit = cache.get(conversationId);
    if (hit) {
      setState({
        status: 'ready',
        conversationId,
        messages: hit.messages,
        omittedCount: hit.omittedCount,
      });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', conversationId });

    void (async () => {
      try {
        const result = await fetchMessagesFromBrowser(conversationId);
        if (cancelled) return;
        const snapshot: HistorySnapshot = {
          messages: result.messages.map(toReducerMessage),
          omittedCount: result.omittedCount,
        };
        cache.set(conversationId, snapshot);
        setState({
          status: 'ready',
          conversationId,
          messages: snapshot.messages,
          omittedCount: snapshot.omittedCount,
        });
      } catch (err) {
        if (cancelled) return;
        // ApiError 404 means the user doesn't own this conversation (or it
        // was deleted). Surface as a generic error — the layout doesn't
        // own routing decisions for 404 anymore (the page-level ownership
        // check still runs server-side via `[conversationId]/page.tsx`
        // and triggers Next's notFound() before the client renders).
        const error = err instanceof Error ? err : new Error(String(err));
        const code =
          err instanceof ApiError ? `(${err.status}) ` : '';
        setState({
          status: 'error',
          conversationId,
          error: new Error(`${code}${error.message}`),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return state;
}

/**
 * Imperative cache helpers — exported so the ChatSurface can preload a
 * just-minted conversation into the cache (so a later navigation back to
 * it doesn't refetch what we already have in MessageStream state).
 */
export function primeConversationHistoryCache(
  conversationId: string,
  snapshot: { messages: Message[]; omittedCount: number },
): void {
  cache.set(conversationId, {
    messages: snapshot.messages,
    omittedCount: snapshot.omittedCount,
  });
}

/** Test-only — reset the module cache between tests. */
export function _resetConversationHistoryCacheForTests(): void {
  cache.clear();
}

function toReducerMessage(dto: MessageDto): Message {
  // Mirror of the mapper that previously lived in
  // `app/chat/[conversationId]/page.tsx`. Kept here so the client-side
  // hydration path stays self-contained.
  const m: Message = {
    id: dto.id,
    role: dto.role,
    content: dto.content,
    status: dto.status,
  };
  if (dto.provider) m.provider = dto.provider;
  if (dto.model) m.model = dto.model;
  if (dto.errorCode) m.errorCode = dto.errorCode;
  if (dto.status === 'failed') {
    m.canRetry = true;
  }
  return m;
}
