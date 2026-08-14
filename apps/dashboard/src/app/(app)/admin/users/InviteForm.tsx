'use client';

import { useActionState } from 'react';
import type { Team } from '@timetrack/contracts';
import { Button } from '../../../../components/ui/Button';
import { inviteUserAction, type InviteState } from './actions';

const INITIAL: InviteState = { ok: false };

/**
 * Invite form. Client component so it can render the action's result inline (success message
 * and, in development, the invite token needed to complete the accept-invite flow) without a
 * full navigation. The action runs server-side and holds the token.
 *
 * The team is picked here rather than assumed: a team is a manager's group, so choosing it at
 * invite time is what puts a new hire under the right manager from day one.
 */
export function InviteForm({ teams }: { teams: Team[] }) {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL);

  return (
    <form
      action={formAction}
      className="bg-surface-raised border-separator mb-6 flex flex-col gap-3 rounded-lg border p-4 shadow-e1 sm:flex-row sm:items-end"
    >
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Name</span>
        <input
          name="name"
          required
          placeholder="Ada Lovelace"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="ada@company.com"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Role</span>
        <select
          name="role"
          defaultValue="EMPLOYEE"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        >
          <option value="EMPLOYEE">Employee</option>
          <option value="MANAGER">Manager</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Team</span>
        <select
          name="teamId"
          required
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Inviting…' : 'Invite'}
      </Button>

      {state.message ? (
        <p
          className={`text-body w-full ${state.ok ? 'text-accent' : 'text-destructive'}`}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      {state.devToken ? (
        <p className="text-text-secondary text-caption w-full">
          Dev invite token (development only):{' '}
          <code className="bg-surface text-text break-all rounded px-1 py-0.5 font-mono">
            {state.devToken}
          </code>
        </p>
      ) : null}
    </form>
  );
}
