// useFocusComposer — keyboard-flow focus management for the chat composer.
//
// LLD Block C (Tasks 47-56). The composer textarea should regain focus at
// exactly three moments so a keyboard-only user never has to reach for the
// mouse:
//
//   1. on mount (initial page load / fresh MessageStream mount)
//   2. on the FALLING edge of the streaming lock (true → false) — i.e. the
//      assistant turn just finished and the composer is usable again
//   3. on every `conversationId` change — navigating to a saved conversation
//      lands focus in the composer
//
// Equally important is what it must NOT do:
//   - It must not steal focus mid-stream (Task 53-54). If the user clicked
//     somewhere else while a turn is streaming, the hook leaves focus alone
//     until the stream completes.
//   - It must not refocus on arbitrary re-renders (Task 55-56). Only the
//     three documented triggers call `focus()`.
//
// The `disabled` input is accepted for API completeness (the composer is
// disabled while the WS is dead or a turn is in flight) but the hook does
// not focus a disabled textarea — focusing a `disabled` element is a no-op
// in the browser anyway, and we don't want to fight the lock. Mount focus
// only fires when the textarea is focusable.

'use client';

import { useEffect, useRef, type RefObject } from 'react';

export type UseFocusComposerArgs = {
  /** Ref to the composer textarea. */
  ref: RefObject<HTMLTextAreaElement | null>;
  /** True while an assistant turn is actively streaming. */
  streaming: boolean;
  /** True while the composer is locked (turn in flight OR socket dead). */
  disabled: boolean;
  /** Active conversation id (null on the new-conversation surface). */
  conversationId: string | null;
};

export function useFocusComposer({
  ref,
  streaming,
  disabled,
  conversationId,
}: UseFocusComposerArgs): void {
  // Track the previous streaming value so the lock-release effect fires
  // ONLY on the true → false edge, never on a render where it was already
  // false (which would re-focus on every keystroke — Task 53-54/55-56).
  const prevStreamingRef = useRef<boolean>(streaming);

  // ----- 1. Focus on mount. -----
  // Empty dep array: runs once. We deliberately do NOT include `disabled`
  // here — on initial mount the composer is enabled, and gating mount focus
  // on `disabled` would skip the common path. `focusTextarea` is a no-op if
  // the ref is somehow disabled.
  useEffect(() => {
    focusTextarea(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- 2. Focus on the streaming lock's falling edge. -----
  useEffect(() => {
    const prev = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    // Only the true → false transition refocuses. Any render where streaming
    // is still true (or was already false) is a no-op so we never yank focus
    // away from wherever the user put it mid-stream.
    if (prev && !streaming) {
      focusTextarea(ref);
    }
  }, [streaming, ref]);

  // ----- 3. Focus on conversationId change. -----
  // Keyed on `conversationId` so it runs on the initial value AND every
  // change. The initial run overlaps with the mount effect (both focus the
  // textarea on first render) which is harmless — focusing an
  // already-focused element is a no-op.
  useEffect(() => {
    focusTextarea(ref);
    // `disabled` intentionally excluded: a conversation switch is an explicit
    // user navigation, not a mid-stream state, so we always want focus to
    // land in the composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // `disabled` is part of the documented API but only consulted defensively
  // inside `focusTextarea` (a disabled element can't take focus). Referenced
  // here so an unused-arg lint rule doesn't flag it.
  void disabled;
}

function focusTextarea(ref: RefObject<HTMLTextAreaElement | null>): void {
  const el = ref.current;
  if (!el) return;
  if (el.disabled) return;
  el.focus();
}
