'use client';

import { useActionState, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
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
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            {deactivated ? 'Reactivate' : 'Deactivate'}
          </Button>
        </form>
        <Button href={`/admin/users/${userId}/export`} variant="secondary" size="sm">
          Export
        </Button>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 text-caption rounded-full border px-3 py-1.5 font-semibold transition-colors"
          >
            Erase…
          </button>
        ) : null}
      </div>

      {state.message ? (
        <span className="text-destructive text-caption">{state.message}</span>
      ) : null}

      {open ? (
        <form action={eraseAction} className="flex flex-col items-end gap-1">
          <input type="hidden" name="userId" value={userId} />
          <span className="text-category-unproductive text-caption">
            ⚠ Permanently deletes all data for {name}. This cannot be undone.
          </span>
          <input
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (required)…"
            aria-label="Erasure reason"
            className="bg-surface border-separator text-text focus:border-accent rounded border px-1.5 py-1 text-caption outline-none transition-colors"
          />
          {eraseState.message ? (
            <span className="text-destructive text-caption">{eraseState.message}</span>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={erasing || reason.trim().length === 0}
            >
              {erasing ? 'Erasing…' : 'Confirm erase'}
            </Button>
            <button
              type="button"
              disabled={erasing}
              onClick={() => {
                setOpen(false);
                setReason('');
              }}
              className="border-separator text-text hover:bg-surface text-caption rounded-full border px-3 py-1.5 font-semibold transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
