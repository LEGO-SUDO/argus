// MessageComposer — sticky-bottom message input rebuilt to match the
// design prototype's `.composer-wrap` + `.composer` block in
// `docs/design/project/styles.css` (lines 597-686) and the `Composer` JSX in
// `docs/design/project/chat.jsx`.
//
// Behavior:
//   - Sticky bottom with a gradient fade so messages above don't read
//     "hard-clipped"
//   - Max-width 720px centered (matches the .chat-conv center column)
//   - Auto-grow textarea, min 44px max 220px, clamped via useEffect
//   - Pill chips row: "N providers configured" / "auto-failover" — chips
//     pull a single source of truth from `providersConfigured` so the chip
//     stays honest (no hard-coded "3 providers" string)
//   - Send button: bg-chat-ink (NOT bg-acc); replaced by Cancel when
//     streaming (red-tinted)
//   - Help row centered below: ⏎ to send · ⇧+⏎ for newline
//   - Placeholder: "Message argus…"
//   - Enter submits; Shift+Enter newline
//
// `disabled` controls input + send disabling (composer lock from the
// reducer). `streaming` controls the Send→Cancel button swap — the
// reducer's `composerDisabled` is a superset of `streaming` so we surface
// both to keep the visual semantic ("locked because a turn is in flight"
// vs "locked because the WS is dead").
'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

type MessageComposerProps = {
  /** True while the reducer holds the composer lock (turn in flight OR
   *  socket dead). Disables the textarea and the Send button. */
  disabled: boolean;
  /** True while a turn is actively streaming. When true the Send button
   *  is swapped for a Cancel button. Always implies `disabled` too. */
  streaming?: boolean;
  /** Number of providers the gateway has configured. Surfaced in the pill
   *  chip — see lib/conversations-api in a future iteration. Defaults to
   *  1 (mock provider) to keep the chip honest until the API surfaces a
   *  real count. */
  providersConfigured?: number;
  onSend: (text: string) => void;
  onCancel?: () => void;
};

const MIN_HEIGHT_PX = 44;
const MAX_HEIGHT_PX = 220;

export function MessageComposer({
  disabled,
  streaming = false,
  providersConfigured = 1,
  onSend,
  onCancel,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow the textarea to fit content, clamped between MIN/MAX. Runs on
  // every text change; resetting to `auto` first is critical so shrink
  // works on backspace.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, ta.scrollHeight));
    ta.style.height = `${next}px`;
  }, [text]);

  /** Programmatic prefill — used by the parent when a starter card is
   *  picked. Exposed via a ref-ish pattern would be cleaner but the
   *  composer is rendered once per chat surface and the parent doesn't
   *  need a handle; instead, the parent passes initial text via a key
   *  swap. Kept here for future use. */

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }, [disabled, onSend, text]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const placeholder = streaming
    ? 'Streaming response… cancel to send another'
    : 'Message argus…';

  return (
    <div
      data-testid="message-composer-wrap"
      className="sticky bottom-0 bg-gradient-to-b from-transparent to-chat-bg pb-5 pt-3.5 px-4 md:px-7"
      style={{
        // Gradient stops at 24% to match the design source's
        // `linear-gradient(to bottom, transparent, var(--chat-bg) 24%)`.
        backgroundImage:
          'linear-gradient(to bottom, transparent, var(--chat-bg) 24%)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        data-testid="message-composer"
        className="mx-auto flex max-w-[720px] flex-col gap-1 rounded-[14px] border border-chat-rule bg-chat-bg p-3 px-3.5 pt-3 pb-2.5 transition-colors duration-150 focus-within:border-[oklch(0.80_0.04_60)]"
        style={{
          boxShadow:
            '0 1px 0 rgba(0,0,0,0.02), 0 8px 32px -8px rgba(0,0,0,0.05)',
        }}
      >
        <label htmlFor="message-input" className="sr-only">
          Message
        </label>
        <textarea
          ref={taRef}
          id="message-input"
          data-testid="message-composer-input"
          aria-label="Message"
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.55] text-chat-ink placeholder:text-chat-ink-3 outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            minHeight: `${MIN_HEIGHT_PX}px`,
            maxHeight: `${MAX_HEIGHT_PX}px`,
          }}
        />

        <div className="flex items-center justify-between pt-1.5">
          <div className="flex items-center gap-1.5 text-[12px] text-chat-ink-3">
            <span
              data-testid="message-composer-provider-pill"
              className="inline-flex items-center gap-1.5 rounded-full border border-chat-rule bg-chat-panel px-2.5 py-[3px] text-[11.5px] text-chat-ink-2"
            >
              <span className="prov" data-prov="mock">
                <span className="swatch" aria-hidden="true" />
              </span>
              auto-failover
            </span>
            <span
              data-testid="message-composer-providers-count"
              className="inline-flex items-center gap-1.5 rounded-full border border-chat-rule bg-chat-panel px-2.5 py-[3px] text-[11.5px] text-chat-ink-2"
            >
              {providersConfigured} provider
              {providersConfigured === 1 ? '' : 's'} configured
            </span>
          </div>

          {streaming ? (
            <button
              type="button"
              data-testid="message-stream-cancel"
              aria-label="Cancel"
              onClick={onCancel}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] px-3 py-[7px] text-[12.5px] font-medium text-err transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
              style={{ background: 'oklch(0.66 0.18 25 / 0.12)' }}
            >
              {/* Stop icon. */}
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                <rect x="2.5" y="2.5" width="6" height="6" fill="currentColor" />
              </svg>
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              data-testid="message-composer-send"
              aria-label="Send"
              disabled={disabled || text.trim().length === 0}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[6px] bg-chat-ink px-3 py-[7px] text-[12.5px] font-medium text-chat-bg transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
              <svg
                width="11"
                height="11"
                viewBox="0 0 11 11"
                aria-hidden="true"
                fill="none"
              >
                <path
                  d="M5.5 9V2M2.5 5L5.5 2L8.5 5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </form>

      <div
        data-testid="message-composer-help"
        className="mx-auto mt-2.5 max-w-[720px] text-center text-[11px] text-chat-ink-3"
      >
        <kbd>⏎</kbd> to send · <kbd>⇧</kbd>+<kbd>⏎</kbd> for newline
      </div>
    </div>
  );
}
