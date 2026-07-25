'use client';

import { useActionState } from 'react';
import { createProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { ProjectColorPicker } from './ProjectColorPicker';

const INITIAL: ProjectActionState = { ok: false };

export function NewProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectAction, INITIAL);
  return (
    <form
      action={formAction}
      className="bg-surface-raised border-separator flex flex-wrap items-end gap-3 rounded-lg border p-4 shadow-e1"
    >
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Name</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="New project"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Color</span>
        <div className="py-2">
          <ProjectColorPicker />
        </div>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent-hover text-body rounded-md px-3 py-2 font-medium text-white transition-colors disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'New project'}
      </button>
      {state.message ? (
        <p className="text-destructive text-body w-full" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
