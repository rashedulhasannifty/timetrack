'use client';

import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { AccountMenu } from './AccountMenu';
import { usePageTitle } from './PageTitleContext';
import { IconMenu } from './icons';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

const ROUTE_TITLES: { prefix: string; title: string; exact?: boolean }[] = [
  { prefix: '/', title: 'Overview', exact: true },
  { prefix: '/projects', title: 'Projects' },
  { prefix: '/reports', title: 'Reports' },
  { prefix: '/approvals', title: 'Approvals' },
  { prefix: '/admin', title: 'Admin' },
  { prefix: '/me', title: 'My time' },
  { prefix: '/people', title: 'Team' },
];

function fallbackTitle(pathname: string): string {
  const hit = ROUTE_TITLES.find((r) =>
    r.exact ? pathname === r.prefix : pathname.startsWith(r.prefix),
  );
  return hit?.title ?? 'TimeTrack';
}

export function TopBar({
  role,
  name,
  email,
  narrow,
  onToggleSidebar,
}: {
  role: string;
  name: string;
  email: string;
  narrow: boolean;
  onToggleSidebar: () => void;
}) {
  const ctxTitle = usePageTitle();
  const pathname = usePathname();
  const title = ctxTitle ?? fallbackTitle(pathname);

  return (
    <header className="border-separator bg-surface-raised sticky top-0 z-30 flex min-h-[60px] items-center gap-4 border-b px-6 py-3">
      {narrow ? (
        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={onToggleSidebar}
          className="border-separator text-text grid h-8 w-8 flex-none place-items-center rounded-sm border"
        >
          <IconMenu width={16} height={16} />
        </button>
      ) : null}
      <h1 className="m-0 truncate text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
      <div className="flex-1" />
      <ThemeToggle />
      <span className="text-caption text-text-secondary border-separator whitespace-nowrap rounded-full border px-2.5 py-[3px] font-semibold">
        {ROLE_LABEL[role] ?? role}
      </span>
      <AccountMenu name={name} email={email} role={role} />
    </header>
  );
}
