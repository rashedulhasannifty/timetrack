'use client';

import type { Subproject } from '@timetrack/contracts';
import { useToastAction } from '../ui/useToastAction';
import { moveTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function TaskMoveForm({
  id,
  projectId,
  currentSubprojectId,
  subprojects,
}: {
  id: string;
  projectId: string;
  currentSubprojectId: string;
  subprojects: Subproject[];
}) {
  const [state, formAction, pending] = useToastAction(moveTaskAction, INITIAL, 'Task moved');
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="subprojectId"
        aria-label="Move to subproject"
        defaultValue={currentSubprojectId}
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-2 py-0.5 text-caption outline-none"
      >
        {subprojects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text-secondary hover:bg-hover hover:text-text rounded-md border px-2 py-0.5 text-caption font-medium transition-colors disabled:opacity-50"
      >
        Move
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
