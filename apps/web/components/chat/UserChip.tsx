// UserChip — 26×26 avatar circle with ink bg + white initials, truncated
// email beside it, icon-button logout on the right.
//
// Mirrors `.chat-side .foot` + `.avatar` + `.email` + `.iconbtn` rules in
// `docs/design/project/styles.css` (lines 346-391) and the corresponding
// JSX block in `docs/design/project/chat.jsx`. Replaces the bare
// "Log out" text button in the previous chat-side foot.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type UserChipProps = {
  email: string;
};

/** Derive a two-character monogram from an email. Falls back to "??" when
 * the input is empty; never throws because we render this on every
 * authenticated page load. */
function initialsFor(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return '??';
  return trimmed.slice(0, 2).toUpperCase();
}

export function UserChip({ email }: UserChipProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleLogout() {
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      // 401 here means the session is already gone server-side — that is
      // exactly the state the user is trying to reach via this button.
      if (!res.ok && res.status !== 401) {
        setError('Could not log out.');
        return;
      }
      startTransition(() => {
        router.push('/login');
      });
    } catch {
      setError('Could not log out.');
    }
  }

  const initials = initialsFor(email);

  return (
    <div
      data-testid="chat-user-chip"
      className="flex items-center justify-between gap-2.5 border-t border-chat-rule p-3 text-[12.5px] text-chat-ink-2"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          aria-hidden="true"
          data-testid="chat-user-avatar"
          className="inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-chat-ink text-[11px] font-medium tracking-[0.02em] text-chat-bg"
        >
          {initials}
        </span>
        <span
          data-testid="chat-user-email"
          className="truncate text-[12px] text-chat-ink"
          title={email}
        >
          {email}
        </span>
      </div>
      <button
        type="button"
        data-testid="logout-button"
        aria-label="Sign out"
        title="Sign out"
        onClick={handleLogout}
        disabled={isPending}
        className="inline-flex h-11 w-11 items-center justify-center rounded-[6px] text-chat-ink-3 transition-colors hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-50"
      >
        {/* Inline SVG for the door / arrow icon — matches the `logout` icon
         * in `docs/design/project/icons.jsx`. Sized 14 to mirror the
         * design's `iconbtn` body. */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5.5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M8 4l3 3-3 3M11 7H5.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error ? (
        <span
          role="alert"
          data-testid="logout-error"
          className="sr-only"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
