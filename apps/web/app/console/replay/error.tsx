// /console/replay/error.tsx — error boundary for the replay route segment.
//
// Next.js requires error.tsx to be a client component. Surfaces a recoverable
// UI with a retry path. Production observability hook (Sentry) would replace
// the console.error once the package is installed.
'use client';

import { useEffect } from 'react';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ReplayError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // TODO: replace with Sentry.captureException once @sentry/nextjs is added.
    // tags: { feature: 'replay', layer: 'route' }, extra: { digest: error.digest }
    // eslint-disable-next-line no-console
    console.error('console-replay-route-error', error);
  }, [error]);

  return (
    <div
      role="alert"
      data-testid="console-replay-route-error"
      className="m-6 max-w-lg rounded-md border border-err/30 bg-err/5 p-4 text-sm text-con-text"
    >
      <p className="font-medium text-err">Failed to load Replay.</p>
      <p className="mt-1 text-con-dim">
        An unexpected error occurred while loading this view. You can try again or
        navigate to a different tab.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={reset}
          data-testid="console-replay-route-error-retry"
          aria-label="Retry loading replay"
          className="rounded-md border border-con-rule px-3 py-1.5 text-sm font-medium text-con-dim hover:bg-con-hover hover:text-con-text focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
