import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';

const NAV = [
  { href: '/', label: 'Team overview' },
  { href: '/me', label: 'My data' },
  { href: '/reports', label: 'Reports' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/admin/settings', label: 'Admin' },
  { href: '/admin/audit', label: 'Audit log' },
];

/**
 * The authenticated app shell. Server Component (PRD §7.6) — the session is resolved
 * server-side; the browser never holds a long-lived API credential. A null session goes
 * to /api/auth/refresh, which reissues it or falls through to /login (see the auth route).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/refresh');

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-white p-4">
        <div className="mb-6 px-2 text-sm font-semibold">TimeTrack</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <form action="/api/auth/logout" method="post" className="mt-6 px-2">
          <span className="block text-xs text-neutral-400">{session.role}</span>
          <button type="submit" className="mt-1 text-sm text-neutral-700 hover:underline">
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
