// /console layout — auth-gated console chrome (LLD Task 170).
//
// Async server component: resolves the session (reusing Phase A's
// getSessionUser) and redirects unauthenticated requests to /login. Wraps the
// tree in `.surface-console` so the shared chat-* tokens flip to the dark
// console palette (globals.css), mounts the single shared SSE stream via
// ConsoleLiveProvider, and renders the ConsoleSidebar + ConsoleHeader + the
// active tab.

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSessionUser } from '@/lib/server-session';
import { ConsoleHeader } from '@/components/console/ConsoleHeader';
import { ConsoleLiveProvider } from '@/components/console/ConsoleLiveProvider';
import { ConsoleSidebar } from '@/components/console/ConsoleSidebar';

import '../console.css';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
    // redirect() throws in the real Next.js runtime; this return satisfies
    // TypeScript and prevents execution in tests where redirect() is mocked.
    return null;
  }

  return (
    <div className="surface-console">
      <ConsoleSidebar email={user.email ?? ''} />
      <main className="con-main">
        <ConsoleLiveProvider>
          <ConsoleHeader />
          {children}
        </ConsoleLiveProvider>
      </main>
    </div>
  );
}
