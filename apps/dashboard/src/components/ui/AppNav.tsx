'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string; exact?: boolean };

const PRIMARY: Item[] = [
  { href: '/overview', label: 'Overview', exact: true },
  { href: '/projects', label: 'Projects' },
  { href: '/reports', label: 'Reports' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/admin/settings', label: 'Admin' },
];

// /install is a public page outside the app shell, but installing the client is a
// per-person action, so it belongs beside "My time" rather than under Admin. The handoff's
// nav drops it entirely; keeping it here is the one deliberate departure, because losing the
// only route to the client download would be a functional regression. Following it leaves the
// shell; the marketing nav there offers "Open dashboard" as the way back.
const SECONDARY: Item[] = [
  { href: '/me', label: 'My time' },
  { href: '/install', label: 'Install the Mac app' },
];

function isActive(pathname: string, item: Item): boolean {
  if (item.exact) {
    // A person's day view is reached from the overview's people table, so the tab it was
    // opened from stays lit rather than leaving no tab current.
    return pathname === item.href || pathname.startsWith('/people/');
  }
  // Admin spans /admin/*; others match their own subtree.
  const base = item.href === '/admin/settings' ? '/admin' : item.href;
  return pathname === base || pathname.startsWith(base + '/');
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`whitespace-nowrap px-3 pb-3 pt-2 text-[14px] transition-colors ${
        active
          ? 'text-text font-semibold shadow-[inset_0_-2px_0_var(--tt-accent)]'
          : 'text-text-secondary hover:text-text font-normal'
      }`}
    >
      {item.label}
    </Link>
  );
}

/**
 * Primary navigation: one horizontal row of tabs under the brand, with the personal items
 * pushed to the trailing edge. The artboard is a fixed 1440px and has no narrow story, so
 * below that the row scrolls sideways instead of collapsing into a drawer — a nav that is
 * always on screen beats one behind a button the reader has to discover.
 */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-7 [scrollbar-width:thin]">
      {PRIMARY.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
      ))}
      <div className="flex-1" />
      {SECONDARY.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
      ))}
    </nav>
  );
}
