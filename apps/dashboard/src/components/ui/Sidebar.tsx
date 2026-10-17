'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import type { Role } from '@timetrack/contracts';
import { canSee, SECTION_HREF, type NavSection } from '../../lib/nav-access';
import {
  IconClock,
  IconTeam,
  IconProjects,
  IconReports,
  IconApprovals,
  IconAdmin,
  IconDownload,
} from './icons';
import { BrandChip } from './BrandMark';
import { AccountMenu } from './AccountMenu';

// One hue per nav section (globals.css --tt-nav-*): the icon carries it, the label stays
// neutral. Kept as a suffix rather than the full var() so NavLink builds the var() once.
// The hue names are the section names, so `hue` also identifies the section for role gating.
type NavHue = NavSection;

type Item = {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  exact?: boolean;
  hue: NavHue;
};

type SidebarProps = {
  narrow: boolean;
  open: boolean;
  onNavigate: () => void;
  footer?: ReactNode;
  name: string;
  email: string;
  role: Role;
};

const PRIMARY: Item[] = [
  { href: SECTION_HREF.overview, label: 'Overview', Icon: IconTeam, exact: true, hue: 'overview' },
  { href: SECTION_HREF.projects, label: 'Projects', Icon: IconProjects, hue: 'projects' },
  { href: SECTION_HREF.reports, label: 'Reports', Icon: IconReports, hue: 'reports' },
  { href: SECTION_HREF.approvals, label: 'Approvals', Icon: IconApprovals, hue: 'approvals' },
  { href: SECTION_HREF.admin, label: 'Admin', Icon: IconAdmin, hue: 'admin' },
];

// /install is a public page outside the app shell, but installing the client is a
// per-person action, so it belongs beside "My time" rather than under Admin. Following it
// leaves the shell; the marketing nav there offers "Open dashboard" as the way back.
const SECONDARY: Item[] = [
  { href: SECTION_HREF.me, label: 'My time', Icon: IconClock, hue: 'me' },
  { href: SECTION_HREF.install, label: 'Install the app', Icon: IconDownload, hue: 'install' },
];

function isActive(pathname: string, item: Item): boolean {
  if (item.exact) {
    // A person's day view is reached from the Overview people table and has no nav item of
    // its own, so Overview stays lit while you are inside it rather than nothing being lit.
    return pathname === item.href || pathname.startsWith('/people/');
  }
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
  const hueVar = `var(--tt-nav-${item.hue})`;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`text-label flex items-center gap-[11px] rounded-md border border-transparent px-[11px] py-[9px] font-semibold transition-colors ${
        active ? 'text-text' : 'text-text-secondary hover:text-text'
      }`}
      style={
        active
          ? {
              backgroundColor: `color-mix(in srgb, ${hueVar} var(--tt-nav-active-mix), transparent)`,
            }
          : undefined
      }
    >
      <Icon width={18} height={18} className="flex-none" style={{ color: hueVar }} />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}

export function Sidebar({ narrow, open, onNavigate, footer, name, email, role }: SidebarProps) {
  const pathname = usePathname();
  // Only what this role can open (lib/nav-access). An EMPLOYEE has no primary items at all.
  const primary = PRIMARY.filter((item) => canSee(role, item.hue));
  const secondary = SECONDARY.filter((item) => canSee(role, item.hue));
  // Off-canvas below 900px, so it needs its own opaque ground and a shadow; docked it sits
  // directly on the page surface with no divider — the raised nav pill carries the edge.
  const positionClass = narrow
    ? 'fixed inset-y-0 left-0 z-[70] bg-surface shadow-e2 transition-transform duration-200'
    : 'sticky top-0 h-screen';
  const transform = narrow ? { transform: `translateX(${open ? '0' : '-105%'})` } : undefined;
  return (
    <aside
      className={`flex w-[224px] shrink-0 flex-col px-4 pb-5 pt-6 ${positionClass}`}
      style={transform}
      aria-label="Primary"
    >
      <div className="flex items-center gap-2.5 px-2.5 pb-7">
        <BrandChip size={28} />
        <span className="text-text font-display text-[15.5px] font-extrabold tracking-[-0.02em]">
          Nifty Timer
        </span>
      </div>

      {primary.length > 0 ? (
        <nav className="flex flex-col gap-0.5 pb-6">
          {primary.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      ) : null}

      <div className="tt-eyebrow text-neutral px-2.5 pb-2">You</div>

      <nav className="flex flex-col gap-0.5">
        {secondary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3.5 pt-6">
        {footer}
        <AccountMenu name={name} email={email} role={role} />
      </div>
    </aside>
  );
}
