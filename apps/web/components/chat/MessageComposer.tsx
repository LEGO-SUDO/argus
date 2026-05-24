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

import { ApiError } from '@/lib/auth-fetch';
import {
  clearConversationPin,
  patchConversationPin,
  type ProviderCatalog,
} from '@/lib/providers-api';
import { clearPinFallbackNotice } from '@/lib/use-conversation-history';
import type { PinFallbackNotice } from '@/lib/use-conversation-history';
import { useFocusComposer } from '@/lib/use-focus-composer';
import { ProviderPicker } from './ProviderPicker';

type MessageComposerProps = {
  /** True while the reducer holds the composer lock (turn in flight OR
   *  socket dead). Disables the textarea and the Send button. */
  disabled: boolean;
  /** True while a turn is actively streaming. When true the Send button
   *  is swapped for a Cancel button. Always implies `disabled` too. */
  streaming?: boolean;
  /** Number of providers the gateway has configured. Surfaced in the legacy
   *  pill chip — only rendered when no `catalog` prop is supplied (i.e. the
   *  pre-ProviderPicker call shape). Defaults to 1. */
  providersConfigured?: number;
  onSend: (text: string) => void;
  onCancel?: () => void;

  // ----- ProviderPicker wiring (LLD Block G2/G3). All optional so legacy
  // call sites (and tests) that don't pass a catalog keep the old pills. -----

  /** Active conversation id — needed to PATCH the pin and to drive the
   *  focus hook. Null on the new-conversation surface. */
  conversationId?: string | null;
  /** Provider catalog from `fetchProviderCatalog`. When present the static
   *  pills are replaced by the ProviderPicker. */
  catalog?: ProviderCatalog;
  /** True while the catalog fetch is in flight — drives the picker's
   *  disabled-loading state (vs the env-var empty-state). Codex finding #6. */
  catalogLoading?: boolean;
  /** Current conversation pin (from useConversationHistory). */
  pinnedProvider?: string | null;
  /** Current conversation pin model. */
  pinnedModel?: string | null;
  /** Inline "previously-pinned model unavailable" notice (first paint of a
   *  resumed conversation whose stale pin fell back). */
  pinFallbackNotice?: PinFallbackNotice;
};

const MIN_HEIGHT_PX = 44;
const MAX_HEIGHT_PX = 220;

export function MessageComposer({
  disabled,
  streaming = false,
  providersConfigured = 1,
  onSend,
  onCancel,
  conversationId = null,
  catalog,
  catalogLoading = false,
  pinnedProvider = null,
  pinnedModel = null,
  pinFallbackNotice,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-focus the composer on mount, on streaming-lock release, and on
  // conversation switch (LLD Task 140 / Block C).
  useFocusComposer({ ref: taRef, streaming, disabled, conversationId });

  // ----- Optimistic pin state (LLD Tasks 125-130). -----
  // The picker reflects the local optimistic pin immediately; on PATCH
  // failure we roll back to the previous values and surface an inline error.
  type PinPair = { provider: string | null; model: string | null };
  const [optimisticPin, setOptimisticPin] = useState<PinPair>({
    provider: pinnedProvider,
    model: pinnedModel,
  });
  // Keep the optimistic pin in sync when the upstream prop changes (e.g. a
  // resumed conversation hydrates with a different pin). Resync on prop pair
  // change so a successful optimistic update isn't clobbered by the same value.
  useEffect(() => {
    setOptimisticPin({ provider: pinnedProvider, model: pinnedModel });
  }, [pinnedProvider, pinnedModel]);

  const [pinError, setPinError] = useState<string | null>(null);
  // PATCH-in-flight flag — disables the picker so rapid changes can't race
  // (Codex finding #4). A request token sequences resolutions so a stale
  // PATCH that resolves out of order can never roll back to old state.
  const [pinBusy, setPinBusy] = useState(false);
  const pinRequestSeq = useRef(0);

  // First-turn pin (Codex finding #1). Before the conversation is minted
  // (`conversationId === null`) there is no row to PATCH, so we HOLD the
  // chosen pin here. When `onConversationMinted` flows the new id in via the
  // `conversationId` prop, the effect below applies the held pin with a PATCH.
  // `null` = nothing pending. A held pair of { null, null } means "clear was
  // chosen pre-send" — but since a brand-new conversation defaults to Auto,
  // an explicit pre-send clear is a no-op, so we only hold concrete pins.
  const pendingPinRef = useRef<PinPair | null>(null);

  // Apply a pin PATCH against a known conversation id with optimistic update,
  // request sequencing, busy-gating, and rollback-on-failure. `next` is the
  // target pin (both null → clear). `previous` is what we roll back to.
  const applyPinPatch = useCallback(
    (id: string, next: PinPair, previous: PinPair) => {
      const seq = ++pinRequestSeq.current;
      setOptimisticPin(next);
      setPinError(null);
      setPinBusy(true);
      const isClear = next.provider === null || next.model === null;
      const req = isClear
        ? clearConversationPin(id)
        : patchConversationPin(id, {
            pinnedProvider: next.provider as string,
            pinnedModel: next.model as string,
          });
      void req
        .then(() => {
          // Only the latest request may settle the busy flag (an earlier,
          // slower PATCH resolving late must not flip busy off while a newer
          // one is still pending).
          if (seq === pinRequestSeq.current) setPinBusy(false);
        })
        .catch((err: unknown) => {
          // Stale failure — a newer request supersedes it; ignore so we don't
          // roll back to state the newer request already moved past.
          if (seq !== pinRequestSeq.current) return;
          setPinBusy(false);
          setOptimisticPin(previous);
          setPinError(
            isClear
              ? err instanceof ApiError
                ? `Could not switch to Auto (${err.code ?? err.status}).`
                : 'Could not switch to Auto. Please try again.'
              : err instanceof ApiError
                ? `Could not pin model (${err.code ?? err.status}).`
                : 'Could not pin model. Please try again.',
          );
        });
    },
    [],
  );

  const handlePin = useCallback(
    (provider: string, model: string) => {
      const previous = optimisticPin;
      if (!conversationId) {
        // Pre-send: no row to PATCH yet. Reflect the choice immediately and
        // hold it to apply once the conversation is minted (finding #1).
        setOptimisticPin({ provider, model });
        setPinError(null);
        pendingPinRef.current = { provider, model };
        return;
      }
      applyPinPatch(conversationId, { provider, model }, previous);
    },
    [conversationId, optimisticPin, applyPinPatch],
  );

  const handleClear = useCallback(() => {
    const previous = optimisticPin;
    if (!conversationId) {
      // Pre-send clear → back to Auto locally; cancel any held pin.
      setOptimisticPin({ provider: null, model: null });
      setPinError(null);
      pendingPinRef.current = null;
      return;
    }
    applyPinPatch(conversationId, { provider: null, model: null }, previous);
  }, [conversationId, optimisticPin, applyPinPatch]);

  // Apply a held pre-send pin once the conversation id arrives (finding #1).
  useEffect(() => {
    if (!conversationId) return;
    const pending = pendingPinRef.current;
    if (!pending || pending.provider === null || pending.model === null) return;
    pendingPinRef.current = null;
    // Roll back target is Auto (a freshly-minted conversation has no pin).
    applyPinPatch(
      conversationId,
      pending,
      { provider: null, model: null },
    );
  }, [conversationId, applyPinPatch]);

  // ----- Inline pin-fallback notice dismissal (LLD Tasks 132-139). -----
  // The notice is sourced from the prop (cache-backed); dismissal calls the
  // cache helper so it doesn't re-show on the next render. We do NOT keep a
  // separate local "hidden" flag — the cache mutation is the single source
  // of truth (Task 139). To reflect the dismissal within this mount (the
  // prop won't change until the hook re-reads the cache), we track the id we
  // dismissed for and suppress rendering for that id.
  const [dismissedForId, setDismissedForId] = useState<string | null>(null);
  const noticeVisible =
    pinFallbackNotice !== undefined && dismissedForId !== conversationId;

  const handleDismissNotice = useCallback(() => {
    if (conversationId) {
      clearPinFallbackNotice(conversationId);
      setDismissedForId(conversationId);
    }
  }, [conversationId]);

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
      {/* Inline "previously-pinned model unavailable" notice (LLD Block G3).
       *  Sits above the composer body; dismissable via the cache helper so it
       *  doesn't re-show on the next render. */}
      {noticeVisible && pinFallbackNotice ? (
        <div
          data-testid="pin-fallback-notice"
          role="status"
          className="mx-auto mb-2 flex max-w-[720px] items-start justify-between gap-2 rounded-[8px] border border-chat-rule bg-chat-panel px-3 py-2 text-[12px] text-chat-ink-2"
        >
          <span>
            Previously pinned{' '}
            <span className="mono text-chat-ink">
              {pinFallbackNotice.provider} · {pinFallbackNotice.model}
            </span>{' '}
            is unavailable — switched to Auto.
          </span>
          <button
            type="button"
            data-testid="pin-fallback-notice-dismiss"
            aria-label="Dismiss notice"
            onClick={handleDismissNotice}
            className="shrink-0 rounded-[4px] px-1 text-chat-ink-3 transition-colors hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            ✕
          </button>
        </div>
      ) : null}

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
            {catalog ? (
              // LLD Task 126 — ProviderPicker replaces the static pills once
              // the catalog is wired in. Reflects the optimistic pin; pin
              // failures roll back + surface the inline error below.
              <ProviderPicker
                catalog={catalog}
                pinnedProvider={optimisticPin.provider}
                pinnedModel={optimisticPin.model}
                onPin={handlePin}
                onClear={handleClear}
                streaming={streaming}
                loading={catalogLoading}
                busy={pinBusy}
              />
            ) : (
              // Legacy static pills — kept for call sites that don't yet pass
              // a catalog (and the pre-existing composer tests).
              <>
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
              </>
            )}
            {pinError ? (
              <span
                data-testid="pin-error-notice"
                role="alert"
                className="text-[11.5px] text-err"
              >
                {pinError}
              </span>
            ) : null}
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
