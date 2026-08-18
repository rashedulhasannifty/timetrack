'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
};

const TABS: Tab[] = [
  { href: '/admin/settings', label: 'Settings' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/audit', label: 'Audit' },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-separator">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-2 text-label font-medium transition-colors ${
              active
                ? 'text-text border-b-2 border-accent -mb-px'
                : 'text-text-secondary hover:text-text border-b-2 border-transparent -mb-px'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
