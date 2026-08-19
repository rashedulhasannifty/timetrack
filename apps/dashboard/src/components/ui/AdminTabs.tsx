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
  return <TabPills tabs={TABS} activeHref={active} ariaLabel="Admin sections" />;
}
