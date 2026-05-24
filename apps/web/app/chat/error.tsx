// /chat/error.tsx — error boundary for the chat route segment.
//
// Next.js requires `error.tsx` to be a client component. We surface a
// minimal recoverable UI; the inline reset prop re-renders the segment
// without a full reload.
'use client';

import { useEffect } from 'react';
import Link from 'next/link';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ChatError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // No sentry yet — log to console so the dev surface still shows what
    // went wrong. Production observability hook would go here.
    // eslint-disable-next-line no-console
    console.error('chat-route-error', error);
  }, [error]);

  return (
    <div
      role="alert"
      data-testid="chat-route-error"
      className="m-6 max-w-lg rounded-md border border-err/30 bg-err/5 p-4 text-sm text-chat-ink"
    >
      <p className="font-medium text-err">Something went wrong.</p>
      <p className="mt-1 text-chat-ink-2">
        We hit an unexpected error loading this view. You can try again or
        head back to the chat home.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={reset}
          data-testid="chat-route-error-retry"
          aria-label="Retry"
          className="rounded-md border border-chat-rule px-3 py-1.5 text-sm font-medium text-chat-ink-2 hover:bg-chat-hover hover:text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          Try again
        </button>
        <Link
          href="/chat"
          data-testid="chat-route-error-home"
          className="rounded-md bg-acc px-3 py-1.5 text-sm font-medium text-white hover:bg-acc-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          New chat
        </Link>
      </div>
    </div>
  );
}
