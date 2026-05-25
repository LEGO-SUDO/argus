// use-debounced-callback — trailing-edge debounce for React callbacks.
//
// LLD frontend-web Phase 4 (Tasks 58-61). Used by the Traces filter bar and
// the tab-level refetch hooks to absorb burst storms: per the HLD Regression
// Risk Surface, a "Generate Samples" run can emit many live ticks in a short
// window and must NOT trigger a refetch storm. This hook coalesces rapid
// back-to-back invocations into a single trailing call at the window boundary.
//
// The returned function is stable across renders (safe to pass to effects /
// memoized children) and always invokes the latest `callback` with the latest
// args. Any pending invocation is cancelled on unmount.

'use client';

import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  // Keep the latest callback + delay in refs so the returned function can stay
  // referentially stable while still calling the freshest closure.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const delayRef = useRef(delayMs);
  delayRef.current = delayMs;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Cancel any pending invocation when the component unmounts.
  useEffect(() => clear, [clear]);

  return useCallback(
    (...args: Args) => {
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(...args);
      }, delayRef.current);
    },
    [clear],
  );
}
