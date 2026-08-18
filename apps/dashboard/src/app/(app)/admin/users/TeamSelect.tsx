'use client';

import { useActionState, useRef } from 'react';
import type { TeamListItem } from '@timetrack/contracts';
import { setUserTeamAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * Per-row team picker. A MANAGER manages their own team, so moving someone here IS reassigning
 * who manages them — and it retroactively moves who can see their entries, activity and
 * screenshots. Client component so an API rejection (unknown team 422) is shown next to the
 * control instead of throwing; submits on change, and on error the DB is unchanged.
 *
 * The move also silently changes which projects the person can pick, because a project belongs
 * to a team and cannot be picked from outside it. That is not obvious from a dropdown — someone
 * moved to a fresh team finds their macOS project list empty within a token lifetime and no
 * screen ever told them why — so the counts are stated before the move, not discovered after.
 */
export function TeamSelect({
  userId,
  userName,
  teamId,
  teams,
}: {
  userId: string;
  userName: string;
  teamId: string;
  teams: TeamListItem[];
}) {
  const [state, formAction, pending] = useActionState(setUserTeamAction, INITIAL);
  // The last team we know is committed. `defaultValue` can't restore the control after a
  // cancel (React leaves an uncontrolled select where the user put it), so a cancel writes
  // this value back by hand — otherwise the dropdown would show a move that never happened.
  const committed = useRef(teamId);

  function confirmMove(event: React.ChangeEvent<HTMLSelectElement>): void {
    const select = event.currentTarget;
    const to = teams.find((t) => t.id === select.value);
    const from = teams.find((t) => t.id === committed.current);
    if (!to || !from || to.id === from.id) return;

    if (!window.confirm(describeMove(userName, from, to))) {
      select.value = committed.current;
      return;
    }
    committed.current = to.id;
    select.form?.requestSubmit();
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="teamId"
        defaultValue={teamId}
        disabled={pending || teams.length < 2}
        aria-label="Team"
        title={teams.length < 2 ? 'Create a second team to move people between teams' : undefined}
        onChange={confirmMove}
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

/**
 * Exported for test: the wording is the whole point of the control, and it is the only part
 * worth pinning — a confirm() that says nothing specific is the same trap with an extra click.
 */
export function describeMove(
  userName: string,
  from: { name: string; projectCount: number },
  to: { name: string; projectCount: number },
): string {
  const leaving =
    from.projectCount === 0
      ? `${from.name} has no projects.`
      : `${from.name}’s ${from.projectCount} project${from.projectCount === 1 ? '' : 's'} stay with ${from.name} — ${userName} will no longer be able to track against ${from.projectCount === 1 ? 'it' : 'them'}.`;
  const arriving =
    to.projectCount === 0
      ? `${to.name} has no projects yet, so ${userName} will have nothing to pick until one is created there.`
      : `${to.name} has ${to.projectCount} project${to.projectCount === 1 ? '' : 's'} to pick from.`;
  return [
    `Move ${userName} from ${from.name} to ${to.name}?`,
    '',
    leaving,
    arriving,
    '',
    'Time already tracked is not affected, but the change moves who manages them and who can see their activity.',
  ].join('\n');
}
