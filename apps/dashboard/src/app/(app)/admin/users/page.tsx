import { Forbidden } from '../../../../components/ui/Forbidden';
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

/**
 * Slice 1.2 — the admin's workforce screen: list the team, invite new members, and
 * deactivate/reactivate. ADMIN-only; a non-admin sees the Forbidden view (the API would 403
 * on GET /users anyway). Server Component — the API scopes the list to the caller's team.
 */
export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  if (session.role !== 'ADMIN') return <Forbidden />;

  const users = await api.listUsers(session.accessToken);
  const activeCount = users.filter((u) => u.deactivatedAt === null).length;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-label text-text-secondary tt-numeric flex-1">
            {users.length} users · {activeCount} active
          </span>
        </div>
        <InviteForm />

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
                  <Th>Monitoring</Th>
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
                      <Td className="text-text-secondary">
                        {u.monitoringAckAt ? (
                          `Acknowledged ${formatDate(u.monitoringAckAt)}`
                        ) : (
                          <span className="text-text-secondary">Not acknowledged</span>
                        )}
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
      </div>
    </>
  );
}
