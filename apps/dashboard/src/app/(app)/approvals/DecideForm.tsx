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
        className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        name="status"
        value="APPROVED"
        disabled={pending}
        className="rounded-md border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        Approve
      </button>
      <button
        type="submit"
        name="status"
        value="FLAGGED"
        disabled={pending}
        className="rounded-md border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        Flag
      </button>
      {state.message ? <span className="text-xs text-red-600">{state.message}</span> : null}
    </form>
  );
}
