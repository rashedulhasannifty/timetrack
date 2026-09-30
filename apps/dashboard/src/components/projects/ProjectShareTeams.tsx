'use client';

import { useEffect, useRef, useState } from 'react';
import type { TeamListItem } from '@timetrack/contracts';
import { setProjectTeamsAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { useToastAction } from '../ui/useToastAction';
import { buttonClasses } from '../ui/Button';
import { ConfirmDialog, splitConfirmText } from '../ui/ConfirmDialog';
import { describeShareRemoval, removedTeamIds } from '../../lib/project-share-view';

const INITIAL: ProjectActionState = { ok: false };

/**
 * ADMIN-only "Share…" on a client row: tick the teams that may use it. The home team is always
 * ticked and cannot be unticked (a disabled checkbox is not submitted, so a hidden input carries
 * it); changing the home team is "move", not share.
 */
export function ProjectShareTeams({
  id,
  homeTeamId,
  linkedTeamIds,
  teams,
}: {
  id: string;
  homeTeamId: string;
  linkedTeamIds: string[];
  teams: TeamListItem[];
}) {
  const [state, formAction, pending] = useToastAction(
    setProjectTeamsAction,
    INITIAL,
    'Teams saved',
  );
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Set when the admin has confirmed a removal, so the re-submit below skips the intercept.
  const confirmed = useRef(false);
  // Names of the teams a pending save would unlink; non-null while the confirm is open.
  const [removing, setRemoving] = useState<string[] | null>(null);

  // Close the popover once a save lands. Keyed on the state object, which is new per result.
  useEffect(() => {
    if (state.ok && detailsRef.current) detailsRef.current.open = false;
  }, [state]);

  if (teams.length < 2) return null;
  const linked = new Set(linkedTeamIds);

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    if (confirmed.current) {
      confirmed.current = false;
      return;
    }
    const selected = new FormData(event.currentTarget)
      .getAll('teamId')
      .filter((v): v is string => typeof v === 'string');
    const removed = removedTeamIds(linkedTeamIds, selected);
    if (removed.length === 0) return;
    event.preventDefault();
    setRemoving(removed.map((tid) => teams.find((t) => t.id === tid)?.name ?? 'Unknown team'));
  }

  function confirmRemoval(): void {
    confirmed.current = true;
    setRemoving(null);
    formRef.current?.requestSubmit();
  }

  const text = removing ? splitConfirmText(describeShareRemoval(removing)) : null;

  return (
    <details ref={detailsRef} className="relative">
      <summary className={`${buttonClasses('secondary', 'sm')} cursor-pointer`}>Share…</summary>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={onSubmit}
        className="bg-surface border-separator shadow-e1 absolute z-10 mt-2 flex max-h-72 w-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3"
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="teamId" value={homeTeamId} />
        {teams.map((t) => (
          <label key={t.id} className="text-text text-body flex items-center gap-2">
            <input
              type="checkbox"
              name={t.id === homeTeamId ? undefined : 'teamId'}
              value={t.id}
              defaultChecked={linked.has(t.id)}
              disabled={t.id === homeTeamId}
            />
            {t.name}
            {t.id === homeTeamId ? (
              <span className="text-text-secondary text-caption">(home)</span>
            ) : null}
          </label>
        ))}
        <button type="submit" className={buttonClasses('primary', 'sm')} disabled={pending}>
          Save
        </button>
        {state.message ? <p className="text-destructive text-caption">{state.message}</p> : null}
      </form>
      <ConfirmDialog
        open={text !== null}
        title={text?.title ?? ''}
        message={text?.message ?? ''}
        confirmLabel="Remove teams"
        onConfirm={confirmRemoval}
        onCancel={() => setRemoving(null)}
      />
    </details>
  );
}
