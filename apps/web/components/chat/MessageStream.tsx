// MessageStream — the live chat surface for one conversation.
//
// LLD Tasks 34, 36, 38, 40, 42, 44, 46, 54, 57. Wires the pure reducer in
// `lib/message-stream-reducer.ts` to a typed `WsClient`, renders the
// message list + streaming bubble + composer + Cancel/Retry controls, and
// on the brand-new-conversation path mutates the URL to /chat/<id> when
// the server's first `start` frame arrives carrying the freshly-minted
// conversation id.
//
// URL swap on first `start` frame:
//   - We call `router.replace('/chat/<id>')` (Next navigation).
//   - This is SAFE because MessageStream is hoisted into the chat layout
//     (`ChatSurface` → rendered by `ChatShell` → rendered by the chat
//     layout). The layout is stable across both `/chat` and `/chat/<id>`,
//     so the Next route reconciliation that follows a `router.replace`
//     does NOT remount this component. The WS connection survives.
//   - We also notify `onConversationMinted(id)` so the surrounding
//     ChatSurface can mark the id as "locally owned" and skip the
//     history fetch the URL change would otherwise trigger.
//   - Older builds used `window.history.replaceState` to avoid remounting,
//     because the page component (`app/chat/page.tsx` vs
//     `app/chat/[conversationId]/page.tsx`) used to own the mount. That
//     workaround is obsolete now that the host lives in the layout, and
//     `router.replace` is the right primitive (it correctly updates
//     `usePathname()` consumers, the topbar title, and the sidebar
//     active-row highlight without a manual refresh).
//
// Visual rebuild (matches `docs/design/project/chat.jsx`):
//   - Empty + no-active-conversation state renders the <ChatHero/>; starter
//     clicks pre-fill the composer and submit on the user's behalf
//   - Centered 720px conversation column
//   - Streaming bubble renders the SAME meta-above-body shape that
//     terminal assistant messages render — visual continuity from
//     streaming → complete
//   - Cancel is moved into the composer (replaces Send) per the design;
//     no longer a per-bubble action
//   - aria-live="polite" + role="log" on the streaming region so screen
//     readers announce tokens as they arrive
//
// The component accepts a `wsClient` prop so tests can inject a stub; in
// production the default factory creates a `WsClient` pointed at
// `NEXT_PUBLIC_WS_URL` (resolved in `ws-client.ts`).
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  initialState,
  reducer,
  type Message,
} from '@/lib/message-stream-reducer';
import {
  WsClient,
  type ErrorHandler,
  type FrameHandler,
  type CloseHandler,
  type OpenHandler,
} from '@/lib/ws-client';
import { ChatHero } from './ChatHero';
import { ContextMeter } from './ContextMeter';
import { MessageComposer } from './MessageComposer';
import { MessageContent } from './MessageContent';
import { MessageList, MessageMeta } from './MessageList';
import { OmittedIndicator } from './OmittedIndicator';
import type { ProviderCatalog } from '@/lib/providers-api';
import type { PinFallbackNotice } from '@/lib/use-conversation-history';
import type { WsFrameInbound } from '@argus/contracts';

/**
 * Subset of WsClient that MessageStream actually consumes — exposed for the
 * test harness so a stub doesn't have to implement the entire class
 * (including constructor side effects).
 *
 * `onOpen` is optional so existing stubs without an open hook keep working;
 * when omitted the component flips `wsReady=true` immediately on mount (the
 * stub is treated as already-open).
 */
export type WsClientLike = {
  onFrame: (handler: FrameHandler) => void;
  onError: (handler: ErrorHandler) => void;
  onClose: (handler: CloseHandler) => void;
  onOpen?: (handler: OpenHandler) => void;
  send: (frame: WsFrameInbound) => void;
  close: () => void;
};

type MessageStreamProps = {
  conversationId: string | null;
  initialMessages: Message[];
  omittedCount?: number;
  /**
   * Optional WsClient. Tests inject a stub; production callers omit it so
   * the component constructs a real WsClient against `NEXT_PUBLIC_WS_URL`.
   */
  wsClient?: WsClientLike;
  /**
   * Invoked once when the server's first `start` frame carries a
   * freshly-minted conversation id (the new-conversation flow). The host
   * (ChatSurface) uses this to mark the id as locally-owned so the
   * client-side history fetch hook doesn't try to re-hydrate a
   * conversation whose state is already authoritative in this mount.
   * Optional so tests don't have to thread it through.
   */
  onConversationMinted?: (conversationId: string) => void;

  // ----- ProviderPicker wiring, threaded through to MessageComposer (LLD
  // Block G2/G3). All optional so existing tests/call sites that omit them
  // fall back to the composer's legacy pills. -----
  /** Provider catalog from ChatSurface's mount-time fetch. */
  providerCatalog?: ProviderCatalog;
  /** True while ChatSurface is still fetching the catalog — drives the
   *  picker's disabled-loading state vs the empty-state (Codex finding #6). */
  catalogLoading?: boolean;
  /** Conversation pin (from useConversationHistory via ChatSurface). */
  pinnedProvider?: string | null;
  pinnedModel?: string | null;
  /** Inline stale-pin fallback notice (first paint of a resumed convo). */
  pinFallbackNotice?: PinFallbackNotice;
};

export function MessageStream({
  conversationId,
  initialMessages,
  omittedCount = 0,
  wsClient,
  onConversationMinted,
  providerCatalog,
  catalogLoading = false,
  pinnedProvider = null,
  pinnedModel = null,
  pinFallbackNotice,
}: MessageStreamProps) {
  const router = useRouter();
  // Lazy init — applies `initialMessages` + `omittedCount` on first render
  // so the OmittedIndicator paints with the right number on the very first
  // frame (no flash of "0 omitted" before a mount-time dispatch lands).
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...initialState,
    messages: initialMessages,
    omittedCount,
  }));
  // When an injected stub is supplied (tests), we treat the socket as
  // already open. Real WsClient flips this in the open handler below.
  const [wsReady, setWsReady] = useState<boolean>(Boolean(wsClient));
  const [wsError, setWsError] = useState<string | null>(null);
  // Composer pre-fill seed — bumping `composerSeed` forces the composer
  // to remount with the new initial value (via key). This is the chosen
  // primitive for starter-card pre-fill; React form refs are messier.
  const [composerSeed, setComposerSeed] = useState<{
    key: number;
    text: string;
  }>({ key: 0, text: '' });

  // Track the conversation id over the lifetime of this mount — starts null
  // for a brand-new conversation, then mutates to the server-minted id on
  // the first `start` frame. Stored in a ref because we don't render off
  // this value (we drive the URL via `router.replace` for the swap).
  //
  // Reactive sync: the prop is allowed to change without a remount when
  // the host (ChatSurface) updates `conversationId` after the URL swap.
  // The effect below keeps the ref in lockstep so subsequent sends carry
  // the right id.
  const liveConvIdRef = useRef<string | null>(conversationId);
  useEffect(() => {
    liveConvIdRef.current = conversationId;
  }, [conversationId]);

  // Latest router + minted-callback in refs so the mount-time WS effect
  // (which deliberately runs once) can call into the most recent values
  // without re-running the effect (which would tear down the WS).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const onMintedRef = useRef(onConversationMinted);
  useEffect(() => {
    onMintedRef.current = onConversationMinted;
  }, [onConversationMinted]);

  // -------------------------------------------------------------------------
  // WS client lifecycle.
  //
  // CRITICAL: the WsClient is constructed inside useEffect, NEVER during
  // render. Rendering on the server (`new WebSocket()` is undefined in
  // Node) or under React 19 StrictMode (double-invoke) would otherwise
  // crash. The ref starts null; the effect populates it on mount, wires
  // every handler before any `setState` could mutate the tree, and tears
  // down on unmount.
  // -------------------------------------------------------------------------
  const clientRef = useRef<WsClientLike | null>(wsClient ?? null);

  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new WsClient();
    }
    const client = clientRef.current;

    const onFrame: FrameHandler = (frame) => {
      // On the first `start` frame for a brand-new conversation, learn
      // the freshly-minted conversation id and reflect it in the URL.
      //
      // We use `router.replace` (Next navigation) — safe because this
      // component is hosted in the chat layout, which is stable across
      // both `/chat` and `/chat/<id>`. The Next reconciliation that
      // follows does NOT remount us, so the WS connection + reducer
      // state survive intact.
      //
      // `onConversationMinted` notifies the host (ChatSurface) so the
      // history-fetch hook can skip the id (the live state owned by this
      // component is authoritative; refetching would briefly wipe the
      // transcript while loading lands).
      if (
        frame.type === 'start' &&
        liveConvIdRef.current === null &&
        frame.conversationId
      ) {
        const mintedId = frame.conversationId;
        liveConvIdRef.current = mintedId;
        // Notify host BEFORE the router call so the history-fetch hook
        // sees the id in `mintedIds` by the time it reacts to the
        // pathname change.
        onMintedRef.current?.(mintedId);
        routerRef.current.replace(`/chat/${mintedId}`);
        // Re-fetch Server Component data for the current tree — pulls
        // the freshly-created conversation into the sidebar list without
        // a full page reload.
        routerRef.current.refresh();
      }
      dispatch({ type: 'frame', frame });
    };
    const onError: ErrorHandler = (err) => {
      // Surface as a soft banner — the reducer's terminalError is reserved
      // for server-emitted error frames.
      setWsError(`Connection issue (${err.reason}). Please retry.`);
    };
    const onClose: CloseHandler = (_code) => {
      setWsReady(false);
    };
    const onOpen: OpenHandler = () => {
      setWsReady(true);
    };

    client.onFrame(onFrame);
    client.onError(onError);
    client.onClose(onClose);
    if (typeof client.onOpen === 'function') {
      client.onOpen(onOpen);
    } else {
      // Test stub without an open hook — treat as already-open.
      setWsReady(true);
    }

    return () => {
      client.close();
      // Drop the ref on teardown so a StrictMode remount in dev gets a
      // fresh client rather than re-using a closed one.
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convenience accessor — every send/cancel/retry path uses this.
  const client = clientRef.current;

  // Last user message text — used for Retry resends (LLD Task 38).
  const lastUserText = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m && m.role === 'user') {
        return m.content;
      }
    }
    return null;
  }, [state.messages]);

  // ContextMeter source (LLD Tasks 96-97): the MOST-RECENT assistant message
  // whose status is `complete`. We deliberately skip failed/canceled rows —
  // those never produced a final token-usage report, so their tokens fields
  // are undefined and the literally-last row may be one of them. Scanning
  // backwards yields the newest completed turn. Returns null when there is
  // no completed assistant message yet (the meter then renders nothing).
  const lastCompletedAssistant = useMemo(() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m && m.role === 'assistant' && m.status === 'complete') {
        return m;
      }
    }
    return null;
  }, [state.messages]);

  // Send handler.
  //
  // Order matters: we attempt the WS send FIRST, then optimistically
  // dispatch the user-row append and composer lock. If send() throws
  // (socket still CONNECTING, network blip), the reducer never enters the
  // "locked, awaiting end frame" state — so the composer doesn't get
  // stuck. The user message is still appended in the success path so the
  // optimistic UI is responsive.
  const handleSend = useCallback(
    (text: string) => {
      if (!client) return;
      // Clear any stale connection banner — the user is taking a new action.
      // If the send below throws because the socket really is dead, we re-set
      // wsError in the catch branch with the actual reason.
      setWsError(null);
      const userMessageId = uuidv4Safe();
      try {
        client.send({
          type: 'send',
          conversationId: liveConvIdRef.current,
          content: text,
        });
      } catch (err) {
        // Surface to the user without locking the composer. We also do NOT
        // append the user row in this branch — there's nothing in flight,
        // so adding a row that the user has to "retry" would be misleading.
        setWsError(`Could not send: ${(err as Error).message}`);
        return;
      }
      dispatch({ type: 'composer-submitted', userMessageId, text });
    },
    [client],
  );

  // Retry handler — re-send the last user text. Dispatches `retry-clicked`
  // (NOT `composer-submitted`) so we don't duplicate the user-row in the
  // transcript. The reducer flips the composer lock back on and clears any
  // terminal-error banner.
  const handleRetry = useCallback(
    (_failedMessageId: string) => {
      if (!client) return;
      if (!lastUserText) return;
      try {
        client.send({
          type: 'send',
          conversationId: liveConvIdRef.current,
          content: lastUserText,
        });
      } catch (err) {
        setWsError(`Could not retry: ${(err as Error).message}`);
        return;
      }
      dispatch({ type: 'retry-clicked' });
    },
    [client, lastUserText],
  );

  // Cancel handler.
  const handleCancel = useCallback(() => {
    if (!client) return;
    const active = state.streaming;
    if (!active) return;
    try {
      client.send({ type: 'cancel', messageId: active.id });
    } catch (err) {
      setWsError(`Could not cancel: ${(err as Error).message}`);
    }
  }, [client, state.streaming]);

  // Starter-card pre-fill: pre-load the composer with the starter text and
  // submit immediately. Matches the design source's flow where clicking a
  // starter sends the message rather than just typing it into the box.
  const handleStarterPick = useCallback(
    (text: string) => {
      // We could just call handleSend(text) and skip the seed entirely.
      // But seeding the composer means the user sees the text in the box
      // for a beat before it submits — that's the design's intent.
      setComposerSeed((prev) => ({ key: prev.key + 1, text }));
      // Submit synchronously — the composer remount will clear itself
      // after `onSend` resolves (which it does in the next microtask).
      handleSend(text);
    },
    [handleSend],
  );

  const streaming = state.streaming;
  // Empty-state check: only show the ChatHero on the new-conversation
  // surface (no conversationId, no messages, no in-flight stream). Note
  // we read `conversationId` directly (the prop) rather than the ref so
  // a render triggered by the URL flipping from null → minted-uuid
  // immediately swaps out of the hero. The mid-stream flip happens before
  // any messages have rendered, so the hero would otherwise linger for a
  // frame.
  const isEmpty =
    state.messages.length === 0 &&
    !streaming &&
    !state.terminalError &&
    conversationId === null;

  return (
    <section
      data-testid="message-stream"
      data-ws-ready={wsReady ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col"
    >
      <div
        className="flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-busy={streaming !== null}
        aria-label="Conversation"
      >
        {isEmpty ? (
          <ChatHero onPickStarter={handleStarterPick} />
        ) : (
          <div
            data-testid="chat-conv"
            className="mx-auto flex max-w-[720px] flex-col gap-7 px-4 pt-8 pb-10 md:px-7"
          >
            {state.omittedCount > 0 ? (
              <div className="flex justify-center">
                <OmittedIndicator count={state.omittedCount} />
              </div>
            ) : null}

            {/* ContextMeter (LLD Task 97) — sourced from the most-recent
             *  completed assistant turn. Returns null when no completed turn
             *  exists yet (no layout box, no shift). Sits above MessageList,
             *  below the OmittedIndicator slot per the placement decision. */}
            {lastCompletedAssistant ? (
              <div className="flex justify-center">
                <ContextMeter
                  tokensUsed={lastCompletedAssistant.tokensUsed}
                  tokensBudget={lastCompletedAssistant.tokensBudget}
                />
              </div>
            ) : null}

            {state.terminalError ? (
              <TerminalErrorBanner code={state.terminalError.errorCode} />
            ) : null}

            <MessageList messages={state.messages} onRetry={handleRetry} />

            {streaming ? (
              <div
                data-testid="message-stream-streaming"
                data-message-id={streaming.id}
                className="flex flex-col gap-1.5"
              >
                <MessageMeta message={streaming} />
                <div
                  className="text-[15px] leading-[1.62] text-chat-ink"
                  style={{ textWrap: 'pretty' }}
                >
                  {/* LLD Task 83 — render the live stream as Markdown.
                   *  react-markdown is resilient to the partial/incomplete
                   *  syntax that arrives mid-stream. The ellipsis placeholder
                   *  shows before any tokens land; the blink caret is kept as
                   *  a sibling so the streaming visual continues. */}
                  {streaming.content ? (
                    <MessageContent
                      role="assistant"
                      content={streaming.content}
                      isStreaming
                    />
                  ) : (
                    <span className="text-chat-ink-3">…</span>
                  )}
                  <span className="caret" aria-hidden="true" />
                </div>
              </div>
            ) : null}

            {wsError ? (
              <p
                role="alert"
                data-testid="message-stream-error"
                className="mx-auto max-w-md rounded-[6px] border border-err/30 bg-err/[0.05] px-3 py-2 text-[12px] text-err"
              >
                {wsError}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <MessageComposer
        key={composerSeed.key}
        disabled={state.composerDisabled}
        streaming={streaming !== null}
        onSend={handleSend}
        onCancel={handleCancel}
        // ProviderPicker wiring (LLD Block G2/G3). `conversationId` is the
        // prop from ChatSurface (derived from the pathname); it is null on a
        // brand-new conversation until the URL swap, then flips to the minted
        // id without remounting. The composer HOLDS a pre-send pin choice and
        // applies it via PATCH when this id arrives (Codex finding #1).
        conversationId={conversationId}
        catalog={providerCatalog}
        catalogLoading={catalogLoading}
        pinnedProvider={pinnedProvider}
        pinnedModel={pinnedModel}
        pinFallbackNotice={pinFallbackNotice}
      />
    </section>
  );
}

// External README anchor for the "no providers configured" remediation
// step. TODO(repo-owner): swap the placeholder for the real GitHub URL
// when the repo is public. We deliberately do NOT link to `/README.md`
// because Next does not serve repo-root markdown in production — the
// link would 404.
const PROVIDER_SETUP_DOCS_URL =
  'https://github.com/OWNER/REPO/blob/main/README.md#providers';

function TerminalErrorBanner({ code }: { code: string }) {
  if (code === 'no_providers_available') {
    return (
      <div
        role="alert"
        data-testid="terminal-error-no-providers"
        className="rounded-[6px] border border-err/30 bg-err/[0.05] px-4 py-3 text-[14px] text-chat-ink"
      >
        <p className="font-medium text-err">No providers available</p>
        <p className="mt-1 text-chat-ink-2">
          The server has no LLM provider configured. See the{' '}
          <a
            href={PROVIDER_SETUP_DOCS_URL}
            data-testid="terminal-error-readme-link"
            target="_blank"
            rel="noopener noreferrer"
            className="text-acc underline hover:text-acc-strong"
          >
            README provider setup section
          </a>{' '}
          for instructions.
        </p>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-testid="terminal-error"
      className="rounded-[6px] border border-err/30 bg-err/[0.05] px-4 py-3 text-[14px] text-err"
    >
      Something went wrong ({code}). Please retry.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Locally-generated user-message id. Uses crypto.randomUUID when available
 * (jsdom + modern browsers do) and a v4 stub otherwise. We don't take a
 * dependency on the `uuid` npm package for one call site.
 */
function uuidv4Safe(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  // Fallback — not cryptographically strong but only used as a local id.
  return 'u-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
