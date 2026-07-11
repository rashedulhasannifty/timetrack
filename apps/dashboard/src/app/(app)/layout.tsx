import type { ReactNode } from 'react';
import Link from 'next/link';

const NAV = [
  { href: '/', label: 'Team overview' },
  { href: '/me', label: 'My data' },
  { href: '/reports', label: 'Reports' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/admin/settings', label: 'Admin' },
];

/**
 * The authenticated app shell. Server Component by default (PRD §7.6) — the session is
 * resolved server-side; the browser never holds a long-lived API credential.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
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
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
