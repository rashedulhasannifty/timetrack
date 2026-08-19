'use client';

import { usePathname } from 'next/navigation';
import { Tabs } from './Tabs';

const TABS = [
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/audit', label: 'Audit' },
];

/** Admin section switcher. Rendered once by the admin layout. */
export function AdminTabs() {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.startsWith(t.href))?.href ?? TABS[0]!.href;
  return <Tabs label="Admin sections" items={TABS} activeHref={active} />;
}
