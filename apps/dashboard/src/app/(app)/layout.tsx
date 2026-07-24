import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { Sidebar } from '../../components/ui/Sidebar';
import { TopBar } from '../../components/ui/TopBar';

/**
 * The authenticated app shell. Server Component (PRD §7.6) — the session is resolved
 * server-side; the browser never holds a long-lived API credential. A null session goes
 * to /api/auth/refresh, which reissues it or falls through to /login (see the auth route).
 * Chrome (Sidebar/TopBar) follows the TimeTrack design system (tokens in globals.css).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/refresh');

  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar date={date} role={session.role} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
