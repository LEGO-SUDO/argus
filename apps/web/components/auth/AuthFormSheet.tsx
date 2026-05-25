// AuthFormSheet — responsive wrapper for the (auth) form pane.
//
// Desktop (md+): the form is the static right pane of the split-shell — same
// as before (centered, no sheet chrome).
//
// Mobile (< md): the hero copy fills the screen and the form rides in a
// bottom sheet that is OPEN BY DEFAULT, so a first-time visitor sees the
// sign-in immediately instead of having to scroll past the pitch to discover
// it. The sheet can be dismissed (close button / backdrop / Esc) to read the
// hero, and reopened via a persistent "Sign in" launcher pinned to the bottom.
//
// The form (`children`) is rendered exactly ONCE — the same element is the
// static pane on desktop and the sheet body on mobile (Tailwind `md:` classes
// neutralize the fixed/translate sheet styling) — so there are no duplicate
// inputs / ids / test ids in the DOM.

'use client';

import { useEffect, useState, type ReactNode } from 'react';

export function AuthFormSheet({ children }: { children: ReactNode }) {
  // Open by default — the whole point is that mobile visitors land on the form.
  const [open, setOpen] = useState(true);

  // Esc closes the sheet (mobile affordance; on desktop the form stays visible
  // regardless because the `md:` classes override the translate).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Backdrop — mobile only, only while open. */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={[
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-300 md:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
      />

      {/* Form container.
          mobile: fixed bottom sheet sliding via translate-y.
          desktop: static centered right pane (sheet styling neutralized). */}
      <main
        data-testid="auth-form-wrap"
        className={[
          'fixed inset-x-0 bottom-0 z-50 max-h-[90vh] w-full overflow-y-auto rounded-t-[20px] border-t border-chat-rule bg-chat-bg px-6 pb-10 pt-3 shadow-[0_-16px_50px_-12px_rgba(0,0,0,0.25)] transition-transform duration-300 ease-out',
          open ? 'translate-y-0' : 'translate-y-full',
          'md:static md:z-auto md:flex md:max-h-none md:translate-y-0 md:items-center md:justify-center md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:px-10 md:pb-10 md:pt-10 md:shadow-none',
        ].join(' ')}
      >
        {/* Sheet chrome — mobile only. */}
        <div className="relative mb-3 md:hidden">
          <div
            aria-hidden="true"
            className="mx-auto h-1 w-10 rounded-full bg-chat-rule-2"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close sign in"
            data-testid="auth-sheet-close"
            className="absolute right-0 top-[-2px] inline-flex h-7 w-7 items-center justify-center rounded-full text-chat-ink-3 transition-colors hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mx-auto w-[360px] max-w-full">{children}</div>
      </main>

      {/* Launcher — mobile only, only while closed. Reopens the sheet. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open sign in"
        data-testid="auth-sheet-launcher"
        className={[
          'fixed inset-x-0 bottom-0 z-40 items-center justify-center gap-2 border-t border-chat-rule bg-chat-panel px-6 py-4 text-[14px] font-medium text-chat-ink shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.2)] md:hidden',
          open ? 'hidden' : 'flex',
        ].join(' ')}
      >
        Sign in to argus-chat
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </>
  );
}
