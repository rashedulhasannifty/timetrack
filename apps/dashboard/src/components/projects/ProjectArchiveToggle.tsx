'use client';

import { useToastAction } from '../ui/useToastAction';
import { archiveProjectAction, type ProjectActionState } from '../../app/(app)/projects/actions';
import { archiveToastMessage } from '../../app/(app)/projects/archive-toast';

const INITIAL: ProjectActionState = { ok: false };

export function ProjectArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useToastAction(archiveProjectAction, INITIAL, (s) =>
    archiveToastMessage('Project', s),
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="border-separator text-text hover:bg-hover rounded-md border px-2.5 py-1 text-label font-medium transition-colors disabled:opacity-50"
      >
        {archived ? 'Unarchive' : 'Archive'}
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
