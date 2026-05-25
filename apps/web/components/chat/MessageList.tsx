// MessageList — pure render of the message log, rebuilt to match the design
// prototype's `.msg` rules in `docs/design/project/styles.css` (lines
// 513-584) and the `Message` JSX in `docs/design/project/chat.jsx`.
//
// Visual model:
//   - Both user and assistant rows are LEFT-aligned (intentionally calm,
//     symmetric — drop the previous right-align for user)
//   - User body: bordered card on `bg-chat-panel`
//   - Assistant body: unwrapped prose (no card), flowing on chat-bg
//   - Meta row sits ABOVE the body (role + provider chip + failover note)
//   - Provider chip is `.prov[data-prov=...]` so the 6×6 swatch dot keys
//     off the data attribute to the right provider token
//   - Hover actions row appears at group:hover (view trace + copy)
//   - Body typography: 15px line-height 1.62 (bumped from text-sm)
//   - Interrupted marker is appended as a sibling, not a footer pill
//
// The streaming bubble (with caret animation) lives in MessageStream
// because it needs the cancel handler and the live token stream; that
// component renders an equivalent meta+body layout so the visual
// transition from streaming → terminal is seamless.
'use client';

import { useCallback, useState } from 'react';
import type { Message } from '@/lib/message-stream-reducer';
import { MessageContent } from './MessageContent';

type MessageListProps = {
  messages: Message[];
  /** Called when the user clicks Retry on a failed message. */
  onRetry: (failedMessageId: string) => void;
  /** Called when the user clicks Resume on a canceled message. Optional so
   *  legacy call sites (and tests) that don't wire it keep working. */
  onResume?: (messageId: string) => void;
  /** Active conversation id — needed to deep-link the per-message "view trace"
   *  action into the operator console. Null/undefined on a brand-new
   *  conversation (no persisted trace yet), which disables the action. */
  conversationId?: string | null;
};

export function MessageList({
  messages,
  onRetry,
  onResume,
  conversationId = null,
}: MessageListProps) {
  return (
    <ol
      data-testid="message-list"
      aria-label="Conversation"
      className="m-0 flex list-none flex-col gap-7 p-0"
    >
      {messages.map((m) => (
        <li
          key={m.id}
          data-testid={`message-row-${m.role}`}
          data-status={m.status}
          className="group flex flex-col gap-1.5"
        >
          <MessageRow
            message={m}
            onRetry={onRetry}
            onResume={onResume}
            conversationId={conversationId}
          />
        </li>
      ))}
    </ol>
  );
}

type MessageRowProps = {
  message: Message;
  onRetry: (failedMessageId: string) => void;
  onResume?: (messageId: string) => void;
  conversationId?: string | null;
};

function MessageRow({ message, onRetry, onResume, conversationId }: MessageRowProps) {
  if (message.role === 'user') {
    return <UserMessage message={message} />;
  }
  if (message.role === 'system') {
    // System rows aren't surfaced in normal chat history today (the api
    // filters them out before persisting), but the reducer's Message type
    // includes them — render a muted prose row so we don't crash if one
    // ever lands.
    return <SystemMessage message={message} />;
  }
  return (
    <AssistantMessage
      message={message}
      onRetry={onRetry}
      onResume={onResume}
      conversationId={conversationId}
    />
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[11.5px] text-chat-ink-3">
        <span className="font-medium lowercase text-chat-ink-2">you</span>
      </div>
      <div
        data-testid={`message-bubble-${message.id}`}
        className="self-start max-w-full whitespace-pre-wrap rounded-[10px] border border-chat-rule-2 bg-chat-panel px-3.5 py-3 text-[15px] leading-[1.62] text-chat-ink"
        style={{ textWrap: 'pretty' }}
      >
        {message.content}
      </div>
    </>
  );
}

function SystemMessage({ message }: { message: Message }) {
  return (
    <div
      data-testid={`message-bubble-${message.id}`}
      className="whitespace-pre-wrap rounded-[10px] border border-dashed border-chat-rule bg-chat-panel px-3.5 py-3 text-[13px] leading-[1.55] text-chat-ink-2"
    >
      {message.content}
    </div>
  );
}

type AssistantMessageProps = {
  message: Message;
  onRetry: (failedMessageId: string) => void;
  onResume?: (messageId: string) => void;
  conversationId?: string | null;
};

function AssistantMessage({
  message,
  onRetry,
  onResume,
  conversationId,
}: AssistantMessageProps) {
  const isInterrupted =
    message.status === 'failed' && message.errorCode === 'client_disconnected';
  const isCanceled = message.status === 'canceled';
  const isFailed = message.status === 'failed' && !isInterrupted;

  // Transient "copied" confirmation (bug fix: the copy action gave no
  // feedback). `copied` flips true on a successful clipboard write and resets
  // after a short beat so the label/icon return to the idle "copy" state.
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard
      .writeText(message.content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard denied (permissions / insecure context) — leave the idle
        // label; surfacing a failure toast here is out of scope.
      });
  }, [message.content]);

  // "View trace" deep-links to the operator console's Traces lens filtered to
  // this conversation. Phase B (the console) is built + deployed, so the old
  // "available in Phase B" no-op is stale. Disabled only when we have no
  // conversation id yet (brand-new conversation, no persisted trace).
  const traceHref = conversationId
    ? `/console/traces?conversationId=${encodeURIComponent(conversationId)}`
    : null;

  // Resume is offered on canceled turns (bug fix: no way to continue a
  // cancelled chat). It asks the model to continue via a fresh turn — true
  // mid-stream resume isn't built. Only shown when a handler is wired.
  const canResume = isCanceled && typeof onResume === 'function';

  return (
    <>
      <MessageMeta message={message} />
      <div
        data-testid={`message-bubble-${message.id}`}
        className={
          'text-[15px] leading-[1.62] ' +
          (isFailed ? 'text-chat-ink-2' : 'text-chat-ink')
        }
        style={{ textWrap: 'pretty' }}
      >
        {/* LLD Task 82 — assistant content renders as Markdown. The raw
         *  source still lives in `message.content`; the copy action below
         *  reads from there (Task 80-81), not from this rendered DOM.
         *  `whitespace-pre-wrap` was dropped from the wrapper because
         *  react-markdown emits real block elements (the prior plain-text
         *  path relied on it for newline preservation). */}
        <MessageContent role="assistant" content={message.content} />
      </div>

      {/* Interrupted marker — appended as a sibling, not a footer pill. */}
      {isCanceled || isInterrupted ? (
        <div
          data-testid="message-status-canceled"
          className="mono text-[12px] text-warn"
        >
          ⌁ stream interrupted
        </div>
      ) : null}

      {/* Resume — re-issues the turn as a continuation so the model picks up
       *  where a canceled stream stopped. Styled as a clear primary action
       *  (filled, with a play glyph) so it reads unambiguously as a button. */}
      {canResume ? (
        <div className="flex gap-2 pt-1.5">
          <button
            type="button"
            data-testid={`message-resume-${message.id}`}
            aria-label="Resume"
            onClick={() => onResume?.(message.id)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[7px] bg-chat-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-chat-bg shadow-sm transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc focus-visible:ring-offset-1"
          >
            {/* Play / continue glyph. */}
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M3 2.2v6.6a.5.5 0 0 0 .77.42l5.2-3.3a.5.5 0 0 0 0-.84L3.77 1.78A.5.5 0 0 0 3 2.2Z" />
            </svg>
            Resume
          </button>
        </div>
      ) : null}

      {isFailed ? (
        <div
          data-testid={`message-status-failed-${message.id}`}
          className="mono text-[12px] text-err"
        >
          ✕ {message.errorCode ?? 'failed'}
        </div>
      ) : null}

      {/* Retry — only on failed messages that the reducer flagged
       *  canRetry. Canceled messages don't show Retry by design
       *  (matches the design source). */}
      {message.status === 'failed' && message.canRetry ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            data-testid={`message-retry-${message.id}`}
            aria-label="Retry"
            onClick={() => onRetry(message.id)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-1.5 text-[12.5px] font-medium text-chat-ink transition-colors hover:border-acc focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Hover actions — view trace + copy. Hidden by default; visible on
       *  group:hover OR when any descendant has focus (keyboard a11y). */}
      <div
        data-testid={`message-actions-${message.id}`}
        className="flex gap-1.5 pt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {traceHref ? (
          <a
            href={traceHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`message-action-view-trace-${message.id}`}
            aria-label="View trace in console (opens in a new tab)"
            title="View this conversation's traces in the operator console (new tab)"
            className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11.5px] text-chat-ink-2 transition-colors hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            {/* External-link icon. */}
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M4 2H2v7h7V7M6.5 2H9v2.5M9 2L4.5 6.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            view trace
          </a>
        ) : (
          <button
            type="button"
            data-testid={`message-action-view-trace-${message.id}`}
            aria-label="View trace"
            aria-disabled="true"
            title="Trace available once the conversation is saved"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-[4px] px-2 py-1 text-[11.5px] text-chat-ink-3 opacity-60"
            onClick={(e) => e.preventDefault()}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              aria-hidden="true"
              fill="none"
            >
              <path
                d="M4 2H2v7h7V7M6.5 2H9v2.5M9 2L4.5 6.5"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            view trace
          </button>
        )}
        <button
          type="button"
          data-testid={`message-action-copy-${message.id}`}
          aria-label={copied ? 'Copied' : 'Copy message'}
          onClick={handleCopy}
          className={
            'inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11.5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ' +
            (copied
              ? 'text-acc'
              : 'text-chat-ink-2 hover:bg-chat-hover hover:text-chat-ink')
          }
        >
          {copied ? (
            <>
              {/* Checkmark — confirms the clipboard write landed. */}
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                aria-hidden="true"
                fill="none"
              >
                <path
                  d="M2 5.5L4.5 8L9 3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              copied
            </>
          ) : (
            <>
              {/* Copy icon. */}
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                aria-hidden="true"
                fill="none"
              >
                <rect
                  x="3"
                  y="3"
                  width="6.5"
                  height="6.5"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <path
                  d="M2 7.5V2a.5.5 0 01.5-.5H7"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
              copy
            </>
          )}
        </button>
      </div>
    </>
  );
}

/**
 * MessageMeta — the role + provider chip + (optional) failover note row
 * above the assistant body. Exported as its own piece so MessageStream can
 * render the same shape above its streaming bubble.
 */
export function MessageMeta({ message }: { message: Message }) {
  // Provisional state (LLD Tasks 141-144): an assistant row whose provider is
  // not yet known (the metadata frame hasn't arrived) shows an ellipsis
  // placeholder next to "assistant" so the chip reads as clearly in-progress
  // rather than blank. The swap to the real provider name is keyed purely on
  // `message.provider` being set — which the reducer does at metadata-frame
  // time (NOT on the first token). User/system rows never show the ellipsis.
  const isAssistant = message.role === 'assistant';
  const isProvisional = isAssistant && !message.provider;

  return (
    <div
      data-testid={`message-meta-${message.id}`}
      className="flex items-center gap-2 text-[11.5px] text-chat-ink-3"
    >
      <span className="font-medium lowercase text-chat-ink-2">assistant</span>
      {message.provider ? (
        <>
          <span aria-hidden="true" className="text-chat-rule">
            ·
          </span>
          <span className="prov" data-prov={message.provider}>
            <span className="swatch" aria-hidden="true" />
            <span
              className="mono"
              data-testid="message-stream-provider"
            >
              {message.provider}
            </span>
            {message.model ? (
              <span
                className="mono text-chat-ink-2"
                data-testid="message-stream-model"
              >
                /{message.model}
              </span>
            ) : null}
          </span>
        </>
      ) : isProvisional ? (
        <span
          data-testid="message-meta-provider-pending"
          className="text-chat-ink-3"
        >
          {/* Visual ellipsis — purely decorative, hidden from AT. */}
          <span aria-hidden="true">…</span>
          {/* SR cue (design review FIX 4): the bare "…" gave screen readers no
           *  "assistant is responding" signal and the provider swap was
           *  silent. This sr-only label rides the streaming region's existing
           *  role="log" aria-live="polite" wrapper (we do NOT add a nested
           *  live region here, which would double-announce). Once the provider
           *  lands this whole branch is replaced by the provider chip — whose
           *  text the SAME live region announces — so there is no
           *  double-announcement of the provisional state. */}
          <span className="sr-only" data-testid="message-meta-provider-pending-sr">
            Assistant is responding…
          </span>
        </span>
      ) : null}
    </div>
  );
}
