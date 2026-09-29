'use client';

import { useToastAction } from '../ui/useToastAction';
import { archiveSubprojectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { archiveToastMessage } from '../../app/(app)/projects/archive-toast';

const INITIAL: ProjectActionState = { ok: false };

export function SubprojectArchiveToggle({
  id,
  projectId,
  archived,
}: {
  id: string;
  projectId: string;
  archived: boolean;
}) {
  const [state, formAction, pending] = useToastAction(archiveSubprojectAction, INITIAL, (s) =>
    archiveToastMessage('Subproject', s),
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text-secondary hover:bg-hover hover:text-text rounded-md border px-2 py-0.5 text-caption font-medium transition-colors disabled:opacity-50"
      >
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
