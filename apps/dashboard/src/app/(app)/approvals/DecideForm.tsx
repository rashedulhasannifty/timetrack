'use client';

import { useActionState } from 'react';
import { decideAction, type DecideState } from './actions';

const INITIAL: DecideState = { ok: false };

/**
 * Approve/Flag controls for one pending (or already-decided, for re-decision) row. Client
 * component so a rejection (e.g. a manager outside the timesheet's team, 403) shows inline
 * instead of throwing. Posts to the decide Server Action, which holds the access token —
 * no token ever reaches this component.
 */
export function DecideForm({ approvalId }: { approvalId: string }) {
  const [state, formAction, pending] = useActionState(decideAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={approvalId} />
      <input
        type="text"
        name="note"
        placeholder="Note (optional)"
        maxLength={2000}
        className="bg-surface-raised border-separator text-text focus:border-accent w-40 rounded-md border px-2 py-1 text-caption outline-none transition-colors"
      />
      <button
        type="submit"
        name="status"
        value="APPROVED"
        disabled={pending}
        className="border-accent/30 text-accent hover:bg-accent/10 rounded-md border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="submit"
        name="status"
        value="FLAGGED"
        disabled={pending}
        className="border-category-unproductive/30 text-category-unproductive hover:bg-category-unproductive/10 rounded-md border px-2.5 py-1 text-caption font-medium transition-colors disabled:opacity-50"
      >
        Flag
      </button>
      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}
    </form>
  );
}
