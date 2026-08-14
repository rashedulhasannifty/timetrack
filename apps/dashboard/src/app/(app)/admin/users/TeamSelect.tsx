'use client';

import { useActionState } from 'react';
import type { Team } from '@timetrack/contracts';
import { setUserTeamAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * Per-row team picker. A MANAGER manages their own team, so moving someone here IS reassigning
 * who manages them — and it retroactively moves who can see their entries, activity and
 * screenshots. Client component so an API rejection (unknown team 422) is shown next to the
 * control instead of throwing; submits on change, and on error the DB is unchanged.
 */
export function TeamSelect({
  userId,
  teamId,
  teams,
}: {
  userId: string;
  teamId: string;
  teams: Team[];
}) {
  const [state, formAction, pending] = useActionState(setUserTeamAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="teamId"
        defaultValue={teamId}
        disabled={pending || teams.length < 2}
        aria-label="Team"
        title={teams.length < 2 ? 'Create a second team to move people between teams' : undefined}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="bg-surface border-separator text-text focus:border-accent text-caption rounded-md border px-2 py-1 outline-none transition-colors disabled:opacity-50"
      >
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
