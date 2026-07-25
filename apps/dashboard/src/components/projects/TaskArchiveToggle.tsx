'use client';

import { useActionState } from 'react';
import { archiveTaskAction, type ProjectActionState } from '../../app/(app)/projects/actions';

const INITIAL: ProjectActionState = { ok: false };

export function TaskArchiveToggle({
  id,
  projectId,
  archived,
}: {
  id: string;
  projectId: string;
  archived: boolean;
}) {
  const [state, formAction, pending] = useActionState(archiveTaskAction, INITIAL);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text-secondary hover:bg-surface hover:text-text rounded-md border px-2 py-0.5 text-caption font-medium transition-colors disabled:opacity-50"
      >
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
