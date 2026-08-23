import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { CreateTeamForm } from './CreateTeamForm';
import { RenameTeamForm } from './RenameTeamForm';

/**
 * The teams surface: every team, how many people are in it, and the two facts about its
 * monitoring policy that decide whether an admin needs to go and look at it.
 *
 * It exists because a team was previously creatable only from a stray input on the Users tab,
 * and — worse — a second team's policy could never be edited at all: the settings write always
 * resolved the admin's own team. The "Edit policy" link is the fix's front door.
 *
 * ADMIN-only; a non-admin sees the Forbidden view (the API 403s on GET /teams anyway, since
 * the team list is the roster of management boundaries).
 */
export default async function AdminTeamsPage() {
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/admin/teams'));
  if (session.role !== 'ADMIN') return <Forbidden />;

  const teams = await api.listTeams(session.accessToken);
  const unassigned = teams.filter((t) => t.memberCount === 0).length;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-label text-text-secondary tt-numeric flex-1">
            {teams.length} {teams.length === 1 ? 'team' : 'teams'}
            {unassigned > 0 ? ` · ${unassigned} with nobody in them` : ''}
          </span>
        </div>

        <CreateTeamForm />

        <Card padding="none" className="overflow-hidden">
          <Table>
            <THead>
              <Tr>
                <Th>Team</Th>
                <Th>Members</Th>
                <Th>Screenshots</Th>
                <Th>Idle threshold</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <Tbody>
              {teams.map((team) => (
                <Tr key={team.id}>
                  <Td>{team.name}</Td>
                  <Td className="tt-numeric">{team.memberCount}</Td>
                  <Td>
                    {team.settings.screenshotsEnabled ? (
                      <Badge tone="good">Every {team.settings.screenshotIntervalMinutes} min</Badge>
                    ) : (
                      <Badge tone="neutral">Off</Badge>
                    )}
                  </Td>
                  <Td className="text-text-secondary tt-numeric">
                    {team.settings.idleThresholdMinutes} min
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-4">
                      <Link
                        href={`/admin/settings?teamId=${team.id}`}
                        className="text-label text-text-secondary hover:text-text transition-colors"
                      >
                        Edit policy
                      </Link>
                      <RenameTeamForm teamId={team.id} name={team.name} />
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>

        <p className="text-text-secondary text-caption max-w-[70ch]">
          A team is the management boundary: a manager sees their own team, and moving someone
          between teams is how they are reassigned — done from the Users tab. Teams cannot be
          deleted here; rename an unused one rather than leaving people without a team.
        </p>
      </div>
    </>
  );
}
