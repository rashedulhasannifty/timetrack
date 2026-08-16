'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { IconClock, IconTeam, IconProjects, IconReports, IconApprovals, IconAdmin } from './icons';
import { BrandMark } from './BrandMark';

type Item = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  exact?: boolean;
};

type SidebarProps = {
  narrow: boolean;
  open: boolean;
  onNavigate: () => void;
  footer?: ReactNode;
};

const PRIMARY: Item[] = [
  { href: '/overview', label: 'Overview', Icon: IconTeam, exact: true },
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

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: Item;
  active: boolean;
  onNavigate: () => void;
}) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
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

export function Sidebar({ narrow, open, onNavigate, footer }: SidebarProps) {
  const pathname = usePathname();
  const positionClass = narrow
    ? 'fixed inset-y-0 left-0 z-[70] shadow-e2 transition-transform duration-200'
    : 'sticky top-0 h-screen';
  const transform = narrow ? { transform: `translateX(${open ? '0' : '-105%'})` } : undefined;
  return (
    <aside
      className={`bg-surface-raised border-separator flex w-60 shrink-0 flex-col border-r px-4 py-5 ${positionClass}`}
      style={transform}
      aria-label="Primary"
    >
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <BrandMark size={26} />
        <span className="text-text font-display text-[17px] font-semibold tracking-tight">
          Nifty Timer
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {PRIMARY.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="border-separator my-4 border-t" />

      <nav className="flex flex-col gap-1">
        {SECONDARY.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {footer ? <div className="mt-auto px-2 pt-4">{footer}</div> : null}
    </aside>
  );
}
