'use client';

import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { resyncAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/** The safety net (spec §8.3, §9): re-applies every team's work types to every client. */
export function ResyncButton() {
  const [state, formAction, pending] = useToastAction(
    resyncAction,
    INITIAL,
    (s) => s.message ?? 'Re-synced',
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Re-syncing…' : 'Re-sync all clients'}
      </Button>
      {state.message ? (
        <span
          className={`text-caption ${state.ok ? 'text-text-secondary' : 'text-destructive'}`}
          role="status"
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
