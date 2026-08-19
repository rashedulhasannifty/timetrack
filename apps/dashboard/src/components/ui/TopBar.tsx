'use client';

import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { usePageKicker, usePageTitle } from './PageTitleContext';
import { IconMenu } from './icons';

type RouteMeta = { prefix: string; title: string; kicker: string; exact?: boolean };

// The kicker says what the page is *for*, in the product's voice — it is the one line of the
// chrome that is allowed to be plain English rather than a label.
const ROUTES: RouteMeta[] = [
  { prefix: '/', title: 'Overview', kicker: 'How the team spent its time', exact: true },
  { prefix: '/overview', title: 'Overview', kicker: 'How the team spent its time' },
  { prefix: '/projects', title: 'Projects', kicker: "Where the team's time goes" },
  { prefix: '/reports', title: 'Reports', kicker: 'Ready for payroll and clients' },
  { prefix: '/approvals', title: 'Approvals', kicker: 'Weekly timesheets awaiting a decision' },
  { prefix: '/admin', title: 'Admin', kicker: 'Team-wide tracking policy' },
  { prefix: '/me', title: 'My time', kicker: 'Everything here is yours only' },
  { prefix: '/people', title: 'Team', kicker: 'Day view' },
];

function routeMeta(pathname: string): RouteMeta | undefined {
  return ROUTES.find((r) => (r.exact ? pathname === r.prefix : pathname.startsWith(r.prefix)));
}

export function TopBar({
  narrow,
  onToggleSidebar,
}: {
  narrow: boolean;
  onToggleSidebar: () => void;
}) {
  const ctxTitle = usePageTitle();
  const ctxKicker = usePageKicker();
  const pathname = usePathname();
  const route = routeMeta(pathname);
  const title = ctxTitle ?? route?.title ?? 'Nifty Timer';
  const kicker = ctxKicker ?? route?.kicker ?? null;

  return (
    <header className="flex flex-none items-end gap-3 px-6 pt-6 sm:px-10 sm:pt-[30px]">
      {narrow ? (
        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={onToggleSidebar}
          className="border-separator bg-surface-raised text-text mb-1 grid h-9 w-9 flex-none place-items-center rounded-full border"
        >
          <IconMenu width={16} height={16} />
        </button>
      ) : null}
      <div className="flex min-w-0 flex-col gap-0.5">
        {kicker ? (
          <span className="tt-numeric text-text-secondary text-caption font-medium">{kicker}</span>
        ) : null}
        <h1 className="m-0 truncate text-h1 font-extrabold tracking-[-0.035em]">{title}</h1>
      </div>
      <div className="flex-1" />
      <ThemeToggle />
    </header>
  );
}
