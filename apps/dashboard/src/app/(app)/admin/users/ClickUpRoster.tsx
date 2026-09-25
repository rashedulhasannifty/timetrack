'use client';

import { useMemo, useState, useTransition } from 'react';
import type { Team } from '@timetrack/contracts';
import { Avatar } from '../../../../components/ui/Avatar';
import { Badge } from '../../../../components/ui/Badge';
import { buttonClasses } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { inviteRosterAction } from './actions';
import type { RosterRow, RosterStatus } from './clickup-status';

const FIELD =
  'bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors';

const STATUS_BADGE: Record<RosterStatus, { tone: 'neutral' | 'accent' | 'good'; label: string }> = {
  'not-invited': { tone: 'neutral', label: 'Not invited' },
  invited: { tone: 'accent', label: 'Invited' },
  'has-account': { tone: 'good', label: 'Has account' },
};

/**
 * The ClickUp tab: the workspace's ClickUp members, each with an Invite button, plus checkboxes
 * to invite several at once. Role and team are picked once at the top and apply to every invite
 * sent from here — the usual case is a batch of employees going into one team.
 */
export function ClickUpRoster({ rows, teams }: { rows: RosterRow[]; teams: Team[] }) {
  const [role, setRole] = useState('EMPLOYEE');
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Map<string, RosterStatus>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [, startTransition] = useTransition();

  const statusOf = (r: RosterRow) => overrides.get(r.email) ?? r.status;
  const openCount = rows.filter((r) => statusOf(r) === 'not-invited').length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyOpen && (overrides.get(r.email) ?? r.status) !== 'not-invited') return false;
      return !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    });
  }, [rows, query, onlyOpen, overrides]);

  const selectable = visible.filter((r) => statusOf(r) === 'not-invited');
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.email));

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.email)));
  }

  function send(emails: string[]) {
    if (emails.length === 0) return;
    setNotice(null);
    setBusy((prev) => new Set([...prev, ...emails]));
    startTransition(async () => {
      const result = await inviteRosterAction(emails, role, teamId);
      setBusy((prev) => new Set([...prev].filter((e) => !emails.includes(e))));
      if (!result.outcomes) {
        setNotice({ ok: false, text: result.message ?? 'Could not send the invites.' });
        return;
      }
      const outcomes = result.outcomes;
      setOverrides(
        (prev) => new Map([...prev, ...outcomes.map((o) => [o.email, o.status] as const)]),
      );
      setErrors((prev) => {
        const next = new Map(prev);
        for (const o of outcomes) {
          if (o.error) next.set(o.email, o.error);
          else next.delete(o.email);
        }
        return next;
      });
      setSelected((prev) => new Set([...prev].filter((e) => !emails.includes(e))));
      const failed = outcomes.filter((o) => o.error).length;
      const sent = outcomes.length - failed;
      setNotice(
        failed === 0
          ? { ok: true, text: sent === 1 ? `Invited ${emails[0]}.` : `Invited ${sent} people.` }
          : { ok: false, text: `${sent} invited, ${failed} failed — see the rows marked in red.` },
      );
    });
  }

  const selectedEmails = [...selected];
  const teamName = teams.find((t) => t.id === teamId)?.name ?? 'the selected team';

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-surface-raised border-separator shadow-e1 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border p-3">
        <label className="text-body inline-flex items-center gap-2">
          <span className="text-text-secondary whitespace-nowrap">Invite as</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD}>
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label className="text-body inline-flex items-center gap-2">
          <span className="text-text-secondary whitespace-nowrap">Into team</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={FIELD}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label="Search ClickUp members"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or email"
          className={`${FIELD} min-w-48 flex-1`}
        />
        <button
          type="button"
          className={buttonClasses('primary')}
          disabled={selectedEmails.length === 0 || busy.size > 0 || !teamId}
          onClick={() => setConfirming(true)}
        >
          Invite selected{selectedEmails.length > 0 ? ` (${selectedEmails.length})` : ''}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-label text-text-secondary inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            className="accent-accent"
          />
          Not yet invited only ({openCount})
        </label>
        {notice ? (
          <p
            role="status"
            className={`text-body ml-auto ${notice.ok ? 'text-accent' : 'text-destructive'}`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>

      <Card padding="none" className="overflow-hidden">
        <Table>
          <THead>
            <Tr>
              <Th>
                <input
                  type="checkbox"
                  aria-label="Select everyone not yet invited"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={toggleAll}
                  className="accent-accent"
                />
              </Th>
              <Th>ClickUp member</Th>
              <Th>ClickUp ID</Th>
              <Th>Status here</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <Tbody>
            {visible.length === 0 ? (
              <Tr>
                <Td colSpan={5} className="text-text-secondary">
                  No one matches.
                </Td>
              </Tr>
            ) : (
              visible.map((r) => {
                const status = statusOf(r);
                const badge = STATUS_BADGE[status];
                const open = status === 'not-invited';
                const sending = busy.has(r.email);
                const error = errors.get(r.email);
                return (
                  <Tr key={r.email}>
                    <Td>
                      {open ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={selected.has(r.email)}
                          onChange={() => toggle(r.email)}
                          className="accent-accent"
                        />
                      ) : null}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={r.name} size={26} />
                        <span className="flex flex-col">
                          <span>{r.name}</span>
                          <span className="text-text-secondary text-caption">{r.email}</span>
                        </span>
                      </span>
                    </Td>
                    <Td className="text-text-secondary tt-numeric">{r.clickupId}</Td>
                    <Td>
                      <span className="flex flex-col items-start gap-1">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        {error ? (
                          <span className="text-destructive text-caption">{error}</span>
                        ) : null}
                      </span>
                    </Td>
                    <Td align="right">
                      {open ? (
                        <button
                          type="button"
                          className={buttonClasses('primary', 'xs')}
                          disabled={sending || !teamId}
                          onClick={() => send([r.email])}
                        >
                          {sending ? 'Inviting…' : 'Invite'}
                        </button>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </Td>
                  </Tr>
                );
              })
            )}
          </Tbody>
        </Table>
      </Card>

      <ConfirmDialog
        open={confirming}
        title={`Invite ${selectedEmails.length} ${selectedEmails.length === 1 ? 'person' : 'people'}?`}
        message={`Each of them gets an invitation email to join ${teamName} as ${role.toLowerCase()}.`}
        confirmLabel="Send invites"
        onConfirm={() => {
          setConfirming(false);
          send(selectedEmails);
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
