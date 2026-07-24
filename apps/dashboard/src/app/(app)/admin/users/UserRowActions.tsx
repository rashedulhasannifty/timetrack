'use client';

import { useActionState, useState } from 'react';
import { setUserActiveAction, eraseUserAction, type RowState } from './actions';

const INITIAL: RowState = { ok: false };

/**
 * Per-row admin controls. Client component so an API rejection (last-active-admin 409,
 * cross-team 403) is shown next to the button instead of throwing. Erase uses inline disclosure
 * with a required reason — irreversible, so it never fires from a single click.
 */
export function UserRowActions({
  userId,
  name,
  deactivated,
}: {
  userId: string;
  name: string;
  deactivated: boolean;
}) {
  const [state, formAction, pending] = useActionState(setUserActiveAction, INITIAL);
  const [eraseState, eraseAction, erasing] = useActionState(eraseUserAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <form action={formAction} className="flex items-center gap-2">
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
        </form>
        <a
          href={`/admin/users/${userId}/export`}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          Export
        </a>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            Erase…
          </button>
        ) : null}
      </div>

      {state.message ? <span className="text-xs text-red-600">{state.message}</span> : null}

      {open ? (
        <form action={eraseAction} className="flex flex-col items-end gap-1">
          <input type="hidden" name="userId" value={userId} />
          <span className="text-xs text-amber-600">
            ⚠ Permanently deletes all data for {name}. This cannot be undone.
          </span>
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (required)…"
            aria-label="Erasure reason"
            className="rounded border border-neutral-300 px-1.5 py-1 text-xs"
          />
          {eraseState.message ? (
            <span className="text-xs text-red-600">{eraseState.message}</span>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={erasing || reason.trim().length === 0}
              className="rounded bg-red-700 px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              {erasing ? 'Erasing…' : 'Confirm erase'}
            </button>
            <button
              type="button"
              disabled={erasing}
              onClick={() => {
                setOpen(false);
                setReason('');
              }}
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
