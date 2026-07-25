'use client';

import { useActionState } from 'react';
import { recolorProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { ProjectColorPicker } from './ProjectColorPicker';

const INITIAL: ProjectActionState = { ok: false };

export function ProjectRecolor({ id, color }: { id: string; color: string | null }) {
  const [state, formAction, pending] = useActionState(recolorProjectAction, INITIAL);
  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <ProjectColorPicker {...(color ? { defaultColor: color } : {})} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text hover:bg-surface rounded-md border px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save color'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
