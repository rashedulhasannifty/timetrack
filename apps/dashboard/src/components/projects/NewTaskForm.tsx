'use client';

import { useActionState } from 'react';
import { createTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function NewTaskForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createTaskAction, INITIAL);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
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
