'use client';

import type { Subproject } from '@timetrack/contracts';
import { useToastAction } from '../ui/useToastAction';
import { createTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function NewTaskForm({
  projectId,
  subprojects,
}: {
  projectId: string;
  subprojects: Subproject[];
}) {
  const [state, formAction, pending] = useToastAction(createTaskAction, INITIAL, 'Task added');
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="subprojectId"
        required
        defaultValue={subprojects.find((s) => s.isDefault)?.id ?? subprojects[0]?.id}
        aria-label="Subproject"
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-2.5 py-1.5 text-label outline-none"
      >
        {subprojects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        name="name"
        required
        maxLength={200}
        placeholder="New task"
        className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-1.5 text-label outline-none transition-colors"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent-hover text-label rounded-md px-3 py-1.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add task'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
