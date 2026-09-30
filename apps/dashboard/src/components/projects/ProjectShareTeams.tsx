'use client';

import type { TeamListItem } from '@timetrack/contracts';
import { setProjectTeamsAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { useToastAction } from '../ui/useToastAction';
import { buttonClasses } from '../ui/Button';

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
  if (teams.length < 2) return null;
  const linked = new Set(linkedTeamIds);

  return (
    <details className="relative">
      <summary className={`${buttonClasses('secondary', 'sm')} cursor-pointer`}>Share…</summary>
      <form
        action={formAction}
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
    </details>
  );
}
