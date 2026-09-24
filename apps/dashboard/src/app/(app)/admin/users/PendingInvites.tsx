import type { PendingInvite, Team } from '@timetrack/contracts';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { formatDate } from '../../../../lib/format';

const ROLE_LABEL = { EMPLOYEE: 'Employee', MANAGER: 'Manager', ADMIN: 'Admin' } as const;

/**
 * The Pending tab: invites sent but not yet accepted, newest first. Expired invites are not
 * listed — the API drops them, and they no longer block a fresh invite to the same address.
 * Server Component: nothing here is interactive.
 */
export function PendingInvites({ invites, teams }: { invites: PendingInvite[]; teams: Team[] }) {
  if (invites.length === 0) {
    return <p className="text-text-secondary text-body">No pending invites.</p>;
  }
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  return (
    <Card padding="none" className="overflow-hidden">
      <Table>
        <THead>
          <Tr>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Team</Th>
            <Th>Invited</Th>
            <Th>Expires</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <Tbody>
          {invites.map((i) => (
            <Tr key={i.id}>
              <Td>{i.email}</Td>
              <Td className="text-text-secondary">{ROLE_LABEL[i.role]}</Td>
              <Td className="text-text-secondary">{teamName.get(i.teamId) ?? '—'}</Td>
              <Td className="text-text-secondary">{formatDate(i.createdAt)}</Td>
              <Td className="text-text-secondary">{formatDate(i.expiresAt)}</Td>
              <Td>
                <Badge tone="accent">Invited</Badge>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
