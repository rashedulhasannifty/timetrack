'use client';

import { useActionState, useRef } from 'react';
import type { TeamListItem } from '@timetrack/contracts';
import { moveProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

/**
 * ADMIN-only "move to team" control on the project page. Modeled on the admin users TeamSelect:
 * submits on change after a confirm that names both teams, and on a cancel or an API error the
 * select goes back to the team that is actually committed. Hidden with fewer than two teams.
 */
export function ProjectTeamMove({
  id,
  projectName,
  teamId,
  teams,
}: {
  id: string;
  projectName: string;
  teamId: string;
  teams: TeamListItem[];
}) {
  const [state, formAction, pending] = useActionState(moveProjectAction, INITIAL);
  // `defaultValue` can't restore an uncontrolled select after a cancel, so the committed team is
  // written back by hand — otherwise the dropdown would show a move that never happened.
  const committed = useRef(teamId);

  if (teams.length < 2) return null;

  function confirmMove(event: React.ChangeEvent<HTMLSelectElement>): void {
    const select = event.currentTarget;
    const to = teams.find((t) => t.id === select.value);
    const from = teams.find((t) => t.id === committed.current);
    if (!to || to.id === committed.current) return;

    if (!window.confirm(describeProjectMove(projectName, from?.name ?? 'its current team', to))) {
      select.value = committed.current;
      return;
    }
    committed.current = to.id;
    select.form?.requestSubmit();
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="text-text-secondary text-label" htmlFor={`project-team-${id}`}>
        Team
      </label>
      <select
        id={`project-team-${id}`}
        name="teamId"
        defaultValue={teamId}
        disabled={pending}
        onChange={confirmMove}
        className="bg-surface border-separator text-text focus:border-accent text-label rounded-md border px-2 py-1 outline-none transition-colors disabled:opacity-50"
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

/** Exported for test: the confirm wording is the part of the control worth pinning. */
export function describeProjectMove(
  projectName: string,
  fromName: string,
  to: { name: string },
): string {
  return [
    `Move “${projectName}” from ${fromName} to ${to.name}?`,
    '',
    `${to.name}’s managers will administer it and ${to.name}’s people will be able to track against it. ${fromName}’s people will no longer be able to pick it.`,
    '',
    'Time already tracked is not affected — those hours stay with the team whose people tracked them.',
  ].join('\n');
}
