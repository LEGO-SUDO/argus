// LogoutButton — one-click logout from the chat surface.
//
// LLD Tasks 23-24. POSTs to /api/auth/logout (forwarding the session cookie
// via `credentials: 'include'`) and, on success, navigates back to /login.
// On failure, surfaces an inline error so the user knows something went
// wrong instead of staying silently authenticated.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleClick() {
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      // A 401 means the session is already gone server-side (expired,
      // revoked, or cleared by another tab). That is exactly the state the
      // user is trying to reach via this button — treat it as success and
      // redirect to /login rather than surfacing a confusing "could not
      // log out" message that leaves them stuck on /chat.
      if (!res.ok && res.status !== 401) {
        setError('Could not log out. Please try again.');
        return;
      }
      startTransition(() => {
        router.push('/login');
      });
    } catch (_err) {
      // Network failure — same message so we don't leak details.
      setError('Could not log out. Please try again.');
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid="logout-button"
        aria-label="Log out"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-md border border-chat-rule px-3 py-1.5 text-sm font-medium text-chat-ink-2 transition-colors hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-50"
      >
        Log out
      </button>
      {error ? (
        <p
          role="alert"
          data-testid="logout-error"
          className="text-xs text-err"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
