// ConsoleSidebar — the persistent left nav for the /console surface.
//
// Mirrors ConsoleSidebar from docs/design/project/console.jsx (lines 83-143),
// using the .con-side CSS classes from apps/web/app/console.css. Active nav
// item is detected client-side via usePathname(). Sign-out POSTs to
// /api/auth/logout and pushes to /login on success (same pattern as
// components/chat/LogoutButton.tsx).

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Icon } from './Icon';

const NAV_ITEMS = [
  { key: 'traces', href: '/console/traces', label: 'traces', icon: 'list' as const },
  { key: 'cost', href: '/console/cost', label: 'cost', icon: 'dollar' as const },
  { key: 'replay', href: '/console/replay', label: 'replay', icon: 'replay' as const },
] as const;

export type ConsoleSidebarProps = {
  email: string;
};

export function ConsoleSidebar({ email }: ConsoleSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const initials = email.slice(0, 2).toUpperCase();

  async function handleSignOut() {
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      // A 401 means the session is already gone — treat as success.
      if (!res.ok && res.status !== 401) {
        // Still navigate away; session may be expired on server already.
      }
      router.push('/login');
    } catch {
      // Network failure — navigate to /login regardless.
      router.push('/login');
    }
  }

  return (
    <aside
      data-testid="console-sidebar"
      aria-label="Console navigation"
      className="con-side"
    >
      <div className="head" aria-label="Argus">
        <span
          data-testid="console-sidebar-wordmark"
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--con-text)',
          }}
        >
          argus
        </span>
      </div>

      <div className="section-label">Lenses</div>

      <nav aria-label="Lenses" className="navlist">
        {NAV_ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href) ?? false;
          return (
            <Link
              key={item.key}
              href={item.href}
              data-testid={`console-sidebar-nav-${item.key}`}
              aria-current={active ? 'page' : undefined}
              className={`nav${active ? ' active' : ''}`}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Icon name={item.icon} size={13} aria-hidden="true" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="foot">
        <div
          data-testid="console-sidebar-user-chip"
          className="user-chip"
          aria-label={`Signed in as ${email}`}
        >
          <span
            aria-hidden="true"
            className="avatar"
          >
            {initials}
          </span>
          <span
            data-testid="console-sidebar-email"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {email}
          </span>
        </div>
        <button
          type="button"
          data-testid="console-sidebar-signout"
          aria-label="Sign out"
          title="Sign out"
          onClick={() => void handleSignOut()}
          className="iconbtn"
        >
          <Icon name="logout" size={13} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
