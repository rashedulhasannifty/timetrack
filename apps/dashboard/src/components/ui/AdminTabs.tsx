'use client';

import { usePathname } from 'next/navigation';
import { TabPills } from './TabPills';

const TABS = [
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/audit', label: 'Audit' },
] as const;

export function AdminTabs() {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.href))?.href ?? TABS[0].href;
  // The bordered tab bar this replaced carried its own separation; a pill track sits flush
  // against whatever follows, so the gap belongs here rather than on all four admin pages.
  return (
    <div className="mb-5">
      <TabPills tabs={TABS} activeHref={active} ariaLabel="Admin sections" />
    </div>
  );
}
