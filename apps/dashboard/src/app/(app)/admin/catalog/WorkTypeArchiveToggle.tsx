'use client';

import { useToastAction } from '../../../../components/ui/useToastAction';
import { setWorkTypeArchivedAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/**
 * Archive hides the work type from every client's picker (its rows archive, never delete);
 * Restore brings the same rows back for the teams that still have it selected.
 */
export function WorkTypeArchiveToggle({ id, archived }: { id: string; archived: boolean }) {
  const [state, formAction, pending] = useToastAction(
    setWorkTypeArchivedAction,
    INITIAL,
    (s) => s.message ?? 'Saved',
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors disabled:opacity-50"
      >
        {archived ? 'Restore' : 'Archive'}
      </button>
      {!state.ok && state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
