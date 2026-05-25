// ConsoleHeader — the .con-topbar: tab nav + LiveBadge + SampleDataButton +
// ClearButton (LLD Task 178).
//
// Reskinned to dev-tool dense design (REVIEW-BRIEF Finding 4). Uses
// .con-topbar / .tabs / .tab / .right CSS classes from console.css. The active
// tab gets an accent underline via .active. Existing aria-current="page",
// data-testid, and refresh-on-action wiring are fully preserved.

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { Icon } from './Icon';
import { LiveBadge } from './LiveBadge';
import { SampleDataButton } from './SampleDataButton';
import { ClearButton } from './ClearButton';

const TABS = [
  { key: 'traces', href: '/console/traces', label: 'Traces', icon: 'list' as const },
  { key: 'cost', href: '/console/cost', label: 'Cost', icon: 'dollar' as const },
  { key: 'replay', href: '/console/replay', label: 'Replay', icon: 'replay' as const },
] as const;

export function ConsoleHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <header
      data-testid="console-header"
      className="con-topbar"
    >
      <nav aria-label="Console tabs" className="tabs">
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href) ?? false;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-testid={`console-tab-${tab.key}`}
              aria-current={active ? 'page' : undefined}
              className={`tab${active ? ' active' : ''}`}
            >
              <Icon name={tab.icon} size={13} aria-hidden="true" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="right">
        <LiveBadge />
        <SampleDataButton onGenerated={refresh} />
        <ClearButton onCleared={refresh} />
      </div>
    </header>
  );
}
