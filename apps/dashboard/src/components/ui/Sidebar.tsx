'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, SVGProps } from 'react';
import { IconClock, IconTeam, IconProjects, IconReports, IconApprovals, IconAdmin } from './icons';

type Item = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  exact?: boolean;
};

const PRIMARY: Item[] = [
  { href: '/', label: 'Team', Icon: IconTeam, exact: true },
  { href: '/projects', label: 'Projects', Icon: IconProjects },
  { href: '/reports', label: 'Reports', Icon: IconReports },
  { href: '/approvals', label: 'Approvals', Icon: IconApprovals },
  { href: '/admin/settings', label: 'Admin', Icon: IconAdmin },
];

const SECONDARY: Item[] = [{ href: '/me', label: 'My time', Icon: IconClock }];

function isActive(pathname: string, item: Item): boolean {
  if (item.exact) return pathname === item.href;
  // Admin spans /admin/*; others match their own subtree.
  const base = item.href === '/admin/settings' ? '/admin' : item.href;
  return pathname === base || pathname.startsWith(base + '/');
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-label transition-colors ${
        active
          ? 'bg-surface text-text font-medium'
          : 'text-text-secondary hover:bg-surface hover:text-text'
      }`}
    >
      <Icon className={active ? 'text-accent' : ''} />
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="bg-surface-raised border-separator flex w-60 shrink-0 flex-col border-r px-4 py-5">
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <span className="bg-accent grid h-8 w-8 place-items-center rounded-[10px] text-white">
          <IconClock width={18} height={18} />
        </span>
        <span className="text-text font-display text-[17px] font-semibold tracking-tight">
          TimeTrack
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {PRIMARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>

      <div className="border-separator my-4 border-t" />

      <nav className="flex flex-col gap-1">
        {SECONDARY.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>
    </aside>
  );
}
