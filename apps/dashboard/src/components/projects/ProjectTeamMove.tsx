'use client';

import { useActionState, useRef, useState } from 'react';
import type { TeamListItem } from '@timetrack/contracts';
import { moveProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { ConfirmDialog, splitConfirmText } from '../ui/ConfirmDialog';

const INITIAL: ProjectActionState = { ok: false };

/**
 * ADMIN-only "move to team" control on the project page. Modeled on the admin users TeamSelect:
 * picking a team opens a confirm modal that names both teams, and only a confirm submits; on a
 * cancel the select goes back to the team that is actually committed. An API rejection is shown
 * next to the control; the DB is unchanged, but (as with TeamSelect) the select keeps the
 * attempted team until the page reloads. Hidden with fewer than two teams.
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
  const formRef = useRef<HTMLFormElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  // The team picked in the select but not yet confirmed; non-null while the modal is open.
  const [target, setTarget] = useState<TeamListItem | null>(null);

  if (teams.length < 2) return null;

  function pick(event: React.ChangeEvent<HTMLSelectElement>): void {
    const to = teams.find((t) => t.id === event.currentTarget.value);
    if (!to || to.id === committed.current) return;
    setTarget(to);
  }

  function cancel(): void {
    if (selectRef.current) selectRef.current.value = committed.current;
    setTarget(null);
  }

  function confirm(): void {
    if (!target) return;
    committed.current = target.id;
    setTarget(null);
    formRef.current?.requestSubmit();
  }

  const fromName = teams.find((t) => t.id === committed.current)?.name ?? 'its current team';
  const text = target ? splitConfirmText(describeProjectMove(projectName, fromName, target)) : null;

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="text-text-secondary text-label" htmlFor={`project-team-${id}`}>
        Team
      </label>
      <select
        ref={selectRef}
        id={`project-team-${id}`}
        name="teamId"
        defaultValue={teamId}
        disabled={pending}
        onChange={pick}
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
      <ConfirmDialog
        open={text !== null}
        title={text?.title ?? ''}
        message={text?.message ?? ''}
        confirmLabel="Move project"
        onConfirm={confirm}
        onCancel={cancel}
      />
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
