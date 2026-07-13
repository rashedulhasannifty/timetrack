'use client';

import { useActionState } from 'react';
import { setUserActiveAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * The deactivate/reactivate control for one user row. Client component so an API rejection
 * (e.g. last-active-admin 409) is shown next to the button instead of throwing.
 */
export function UserRowActions({ userId, deactivated }: { userId: string; deactivated: boolean }) {
  const [state, formAction, pending] = useActionState(setUserActiveAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="deactivated" value={deactivated ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
          deactivated
            ? 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
            : 'border-red-200 text-red-700 hover:bg-red-50'
        }`}
      >
        {deactivated ? 'Reactivate' : 'Deactivate'}
      </button>
      {state.message ? <span className="text-xs text-red-600">{state.message}</span> : null}
    </form>
  );
}
