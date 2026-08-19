import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { api, ApiError } from '../../lib/api-client';
import { AppShell } from '../../components/ui/AppShell';
import { TrackingIndicator } from '../../components/ui/TrackingIndicator';

/**
 * The authenticated app shell. Server Component (PRD §7.6) — the session is resolved
 * server-side; the browser never holds a long-lived API credential. A null session goes
 * to /api/auth/refresh, which reissues it or falls through to /login (see the auth route).
 * Chrome (AppShell -> AppNav) follows the Nifty Timer design system (tokens in globals.css).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/api/auth/refresh');

  let me;
  try {
    me = await api.getCurrentUser(session.accessToken);
  } catch (err) {
    // An expired/invalid token surfaces as 401 → reissue like a null session. Anything
    // else is a genuine server error and should surface (not silently blank the shell).
    if (err instanceof ApiError && err.status === 401) redirect('/api/auth/refresh');
    throw err;
  }

  // Only managers/admins have visibility into the team's live tracking state — an EMPLOYEE's
  // own overview row would otherwise render a misleading "N clients tracking now" footer.
  const canSeeTracking = me.role === 'MANAGER' || me.role === 'ADMIN';

  return (
    <AppShell
      role={me.role}
      name={me.name}
      email={me.email}
      tracking={
        canSeeTracking ? (
          <Suspense fallback={null}>
            <TrackingIndicator token={session.accessToken} />
          </Suspense>
        ) : undefined
      }
    >
      {children}
    </AppShell>
  );
}
