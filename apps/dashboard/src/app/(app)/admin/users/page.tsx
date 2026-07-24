import { PageHeader } from '../../../../components/ui/PageHeader';
import { Forbidden } from '../../../../components/ui/Forbidden';
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

  return (
    <>
      <PageHeader
        title="Users & teams"
        subtitle="Invite, deactivate, and assign roles (PRD §6.6)."
      />
      <InviteForm />

      {users.length === 0 ? (
        <p className="text-text-secondary text-body">
          No users yet. Invite your first teammate above.
        </p>
      ) : (
        <div className="bg-surface-raised border-separator overflow-x-auto rounded-lg border shadow-e1">
          <table className="w-full text-body">
            <thead>
              <tr className="border-separator text-text-secondary border-b text-left">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Monitoring</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const deactivated = u.deactivatedAt !== null;
                return (
                  <tr key={u.id} className="border-separator border-b last:border-0">
                    <td className="text-text px-4 py-2 font-medium">{u.name}</td>
                    <td className="text-text-secondary px-4 py-2">{u.email}</td>
                    <td className="text-text-secondary px-4 py-2">
                      <RoleSelect userId={u.id} role={u.role} />
                    </td>
                    <td className="text-text-secondary px-4 py-2">
                      {u.monitoringAckAt ? (
                        `Acknowledged ${formatDate(u.monitoringAckAt)}`
                      ) : (
                        <span className="text-text-secondary">Not acknowledged</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {deactivated ? (
                        <span className="text-text-secondary">Deactivated</span>
                      ) : (
                        <span className="text-recording">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <UserRowActions userId={u.id} name={u.name} deactivated={deactivated} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
