// ConsoleHeader — console chrome: tab nav + LiveBadge + SampleDataButton +
// ClearButton (LLD Task 178).
//
// The active tab carries aria-current="page". Generate-Samples and Clear both
// trigger a router.refresh() so the active server-rendered tab re-fetches its
// initial slice after the data set changes.

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { LiveBadge } from './LiveBadge';
import { SampleDataButton } from './SampleDataButton';
import { ClearButton } from './ClearButton';

const TABS = [
  { key: 'traces', href: '/console/traces', label: 'Traces' },
  { key: 'cost', href: '/console/cost', label: 'Cost' },
  { key: 'replay', href: '/console/replay', label: 'Replay' },
] as const;

export function ConsoleHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <header
      data-testid="console-header"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-chat-rule bg-chat-panel px-4 py-3"
    >
      <nav aria-label="Console tabs" className="flex items-center gap-1">
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href) ?? false;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-testid={`console-tab-${tab.key}`}
              aria-current={active ? 'page' : undefined}
              className={`min-h-9 rounded-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
                active ? 'bg-chat-ink text-chat-bg' : 'text-chat-ink-2 hover:bg-chat-hover'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <LiveBadge />
        <SampleDataButton onGenerated={refresh} />
        <ClearButton onCleared={refresh} />
      </div>
    </header>
  );
}
