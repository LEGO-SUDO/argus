// /console layout — auth-gated console chrome (LLD Task 170).
//
// Async server component: resolves the session (reusing Phase A's
// getSessionUser) and redirects unauthenticated requests to /login. Wraps the
// tree in `.surface-console` so the shared chat-* tokens flip to the dark
// console palette (globals.css), mounts the single shared SSE stream via
// ConsoleLiveProvider, and renders the ConsoleHeader + the active tab.

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSessionUser } from '@/lib/server-session';
import { ConsoleHeader } from '@/components/console/ConsoleHeader';
import { ConsoleLiveProvider } from '@/components/console/ConsoleLiveProvider';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="surface-console min-h-screen bg-chat-bg text-chat-ink">
      <ConsoleLiveProvider>
        <ConsoleHeader />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </ConsoleLiveProvider>
    </div>
  );
}
