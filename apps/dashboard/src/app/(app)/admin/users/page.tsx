import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { Avatar } from '../../../../components/ui/Avatar';
import { Badge } from '../../../../components/ui/Badge';
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
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-left font-semibold border-b">
                    Name
                  </th>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-left font-semibold border-b">
                    Email
                  </th>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-left font-semibold border-b">
                    Role
                  </th>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-left font-semibold border-b">
                    Monitoring
                  </th>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-left font-semibold border-b">
                    Status
                  </th>
                  <th className="text-caption text-text-secondary border-separator px-[18px] py-3 text-right font-semibold border-b">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const deactivated = u.deactivatedAt !== null;
                  return (
                    <tr key={u.id}>
                      <td className="border-separator px-[18px] py-[11px] border-b">
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={u.name} size={26} />
                          {u.name}
                        </span>
                      </td>
                      <td className="text-text-secondary border-separator px-[18px] py-[11px] border-b">
                        {u.email}
                      </td>
                      <td className="border-separator px-[18px] py-[11px] border-b">
                        <RoleSelect userId={u.id} role={u.role} />
                      </td>
                      <td className="text-text-secondary border-separator px-[18px] py-[11px] border-b">
                        {u.monitoringAckAt ? (
                          `Acknowledged ${formatDate(u.monitoringAckAt)}`
                        ) : (
                          <span className="text-text-secondary">Not acknowledged</span>
                        )}
                      </td>
                      <td className="border-separator px-[18px] py-[11px] border-b">
                        <Badge tone={deactivated ? 'neutral' : 'good'}>
                          {deactivated ? 'Deactivated' : 'Active'}
                        </Badge>
                      </td>
                      <td className="border-separator px-[18px] py-[11px] text-right border-b">
                        <UserRowActions userId={u.id} name={u.name} deactivated={deactivated} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
