'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-surface-raised border-separator text-accent text-caption cursor-pointer rounded-full border px-[13px] py-[5px] font-bold"
      >
        Decide
      </button>
      {open ? (
        <form
          action={formAction}
          className="bg-surface-raised border-separator shadow-e2 absolute right-0 z-40 mt-2 flex w-[220px] flex-col gap-2 rounded-[10px] border p-2"
        >
          <input type="hidden" name="id" value={approvalId} />
          <input
            type="text"
            name="note"
            placeholder="Note (optional)"
            maxLength={2000}
            className="bg-surface border-separator text-text focus:border-accent w-full rounded-md border px-2 py-1 text-caption outline-none"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              name="status"
              value="APPROVED"
              variant="primary"
              size="sm"
              disabled={pending}
            >
              Approve
            </Button>
            <Button
              type="submit"
              name="status"
              value="FLAGGED"
              variant="secondary"
              size="sm"
              disabled={pending}
            >
              Flag for payroll
            </Button>
          </div>
          {state.message ? (
            <span className="text-destructive text-caption">{state.message}</span>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
