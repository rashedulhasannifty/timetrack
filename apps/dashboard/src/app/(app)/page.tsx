import { PageHeader } from '../../components/ui/PageHeader';
import { getSession } from '../../lib/session';
import { api } from '../../lib/api-client';

/**
 * Slice 1.5 shell: proves the authenticated data path — fetch the current team with the
 * session token. The real per-person overview (cards + activity chart) lands in Slice 1.6.
 */
export default async function TeamOverviewPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies the type-narrowing.
  const team = await api.getCurrentTeam(session.accessToken);

  return (
    <>
      <PageHeader title="Team overview" subtitle={`Signed in to ${team.name}.`} />
      <p className="text-sm text-neutral-500">
        Per-person cards and the activity chart arrive in Slice 1.6 (PRD §6.5).
      </p>
    </>
  );
}
