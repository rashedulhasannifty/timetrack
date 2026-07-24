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
        <p className="text-sm text-neutral-500">No users yet. Invite your first teammate above.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
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
                  <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-4 py-2 font-medium">{u.name}</td>
                    <td className="px-4 py-2 text-neutral-600">{u.email}</td>
                    <td className="px-4 py-2 text-neutral-600">
                      <RoleSelect userId={u.id} role={u.role} />
                    </td>
                    <td className="px-4 py-2 text-neutral-600">
                      {u.monitoringAckAt ? (
                        `Acknowledged ${formatDate(u.monitoringAckAt)}`
                      ) : (
                        <span className="text-neutral-400">Not acknowledged</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {deactivated ? (
                        <span className="text-neutral-400">Deactivated</span>
                      ) : (
                        <span className="text-green-700">Active</span>
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
