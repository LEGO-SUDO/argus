// SurfaceSwitch — the chat ⇄ console pill in the chat topbar's right slot.
//
// Phase A shipped this slot empty; this fills it (REVIEW follow-up: there was
// no way to reach /console from /chat). Mirrors `.surface-switch` in
// docs/design/project/styles.css and the `<SurfaceSwitch />` in chat.jsx:
// a rounded segmented control with the active surface raised. Path-aware so it
// works mounted on either surface.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SURFACES = [
  { href: '/chat', label: '/chat' },
  { href: '/console', label: '/console' },
] as const;

export function SurfaceSwitch() {
  const pathname = usePathname();
  const activeHref = pathname?.startsWith('/console') ? '/console' : '/chat';

  return (
    <nav
      data-testid="surface-switch"
      aria-label="Switch surface"
      className="flex items-center gap-1 rounded-full border border-chat-rule bg-chat-panel p-[3px] text-[12px]"
    >
      {SURFACES.map(({ href, label }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            data-testid={`surface-switch-${href === '/chat' ? 'chat' : 'console'}`}
            aria-current={active ? 'page' : undefined}
            className={[
              'mono rounded-full px-3 py-[5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc',
              active
                ? 'bg-chat-bg text-chat-ink shadow-[0_1px_0_rgba(0,0,0,0.04)]'
                : 'text-chat-ink-2 hover:text-chat-ink',
            ].join(' ')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
