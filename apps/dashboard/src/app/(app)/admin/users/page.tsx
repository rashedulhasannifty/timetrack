import { Forbidden } from '../../../../components/ui/Forbidden';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { Card } from '../../../../components/ui/Card';
import { Avatar } from '../../../../components/ui/Avatar';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { formatDate } from '../../../../lib/format';
import { InviteForm } from './InviteForm';
import { UserRowActions } from './UserRowActions';
import { RoleSelect } from './RoleSelect';
import { TeamSelect } from './TeamSelect';
import { AppVersionCell } from './AppVersionCell';
import { fetchLatestReleases } from '../../../../lib/client-releases';
import { installsByUser } from '../../../../lib/client-version';
import { TabPills } from '../../../../components/ui/TabPills';
import { ClickUpRoster } from './ClickUpRoster';
import { PendingInvites } from './PendingInvites';
import { CLICKUP_ROSTER } from './clickup-roster';
import { buildRosterRows } from './clickup-status';

/**
 * The admin's workforce screen: list everyone, invite new members, assign them to a manager by
 * setting their team, and deactivate/reactivate. ADMIN-only; a non-admin sees the Forbidden view
 * (the API would 403 on GET /users anyway).
 *
 * Server Component. For an ADMIN the API returns every user in the deployment, not just their
 * own team — assigning people to managers is impossible from a single-team roster.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  // Next 16 — searchParams is async.
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo('/admin/users'));
  if (session.role !== 'ADMIN') return <Forbidden />;

  const [users, teams, installs, latest, pending] = await Promise.all([
    api.listUsers(session.accessToken),
    api.listTeams(session.accessToken),
    api.listClientInstalls(session.accessToken),
    fetchLatestReleases(),
    api.listPendingInvites(session.accessToken),
  ]);
  const appsByUser = installsByUser(installs, latest, new Date());
  const activeCount = users.filter((u) => u.deactivatedAt === null).length;
  // `?tab=` picks the list, so the selected tab survives a reload and can be linked to.
  const requested = (await searchParams).tab;
  const tab = requested === 'clickup' || requested === 'pending' ? requested : 'members';
  const rosterRows = buildRosterRows(CLICKUP_ROSTER, users, pending);
  const tabs = [
    { href: '/admin/users', label: 'Members', count: users.length },
    { href: '/admin/users?tab=pending', label: 'Pending', count: pending.length },
    { href: '/admin/users?tab=clickup', label: 'ClickUp', count: rosterRows.length },
  ];
  const activeHref = tabs.find((t) => t.href.endsWith(`tab=${tab}`))?.href ?? tabs[0]!.href;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-label text-text-secondary tt-numeric flex-1">
            {users.length} users · {activeCount} active · {teams.length}{' '}
            {teams.length === 1 ? 'team' : 'teams'}
          </span>
          <TabPills tabs={tabs} activeHref={activeHref} ariaLabel="User lists" />
        </div>

        {tab === 'clickup' ? (
          <ClickUpRoster rows={rosterRows} teams={teams} />
        ) : tab === 'pending' ? (
          <PendingInvites invites={pending} teams={teams} />
        ) : (
          <>
            <InviteForm teams={teams} />

            {users.length === 0 ? (
              <p className="text-text-secondary text-body">
                No users yet. Invite your first teammate above.
              </p>
            ) : (
              <Card padding="none" className="overflow-hidden">
                <Table>
                  <THead>
                    <Tr>
                      <Th>Name</Th>
                      <Th>Email</Th>
                      <Th>Role</Th>
                      <Th>Team</Th>
                      <Th>Monitoring</Th>
                      <Th>App</Th>
                      <Th>Status</Th>
                      <Th align="right">Actions</Th>
                    </Tr>
                  </THead>
                  <Tbody>
                    {users.map((u) => {
                      const deactivated = u.deactivatedAt !== null;
                      return (
                        <Tr key={u.id}>
                          <Td>
                            <span className="inline-flex items-center gap-2">
                              <Avatar name={u.name} size={26} />
                              {u.name}
                            </span>
                          </Td>
                          <Td className="text-text-secondary">{u.email}</Td>
                          <Td>
                            <RoleSelect userId={u.id} role={u.role} />
                          </Td>
                          <Td>
                            <TeamSelect
                              userId={u.id}
                              userName={u.name}
                              teamId={u.teamId}
                              teams={teams}
                            />
                          </Td>
                          <Td className="text-text-secondary">
                            {u.monitoringAckAt ? (
                              `Acknowledged ${formatDate(u.monitoringAckAt)}`
                            ) : (
                              <span className="text-text-secondary">Not acknowledged</span>
                            )}
                          </Td>
                          <Td>
                            <AppVersionCell installs={appsByUser.get(u.id) ?? []} />
                          </Td>
                          <Td>
                            <Badge tone={deactivated ? 'neutral' : 'good'}>
                              {deactivated ? 'Deactivated' : 'Active'}
                            </Badge>
                          </Td>
                          <Td align="right">
                            <UserRowActions userId={u.id} name={u.name} deactivated={deactivated} />
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  );
}
