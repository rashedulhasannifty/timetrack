'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { resolveIdleAction, type ResolveIdleState } from './actions';
import type { IdleRow } from '../../../lib/idle-view';

const INITIAL: ResolveIdleState = { ok: false };

/**
 * Keep/Discard for one of your own idle periods. A disclosure rather than two bare buttons,
 * because Discard drops the overlapping auto-tracked time -- it deserves a deliberate second
 * click, and it matches the Decide control on approvals.
 *
 * Client component so a rejection shows inline instead of throwing; the access token stays in
 * the Server Action.
 */
export function ResolveIdleForm({ row }: { row: IdleRow }) {
  const [state, formAction, pending] = useActionState(resolveIdleAction, INITIAL);
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

  const unresolved = row.outcome === 'UNRESOLVED';

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          unresolved
            ? 'bg-accent text-caption cursor-pointer rounded-full px-[14px] py-[5px] font-bold text-white'
            : 'border-separator text-text-secondary hover:text-text text-caption cursor-pointer rounded-full border px-[14px] py-[5px] font-bold'
        }
      >
        {unresolved ? 'Resolve' : 'Change'}
      </button>
      {open ? (
        <form
          action={formAction}
          className="bg-surface-raised border-separator shadow-e2 absolute right-0 z-40 mt-2 flex w-[260px] flex-col gap-2 rounded-[14px] border p-2.5"
        >
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="startTime" value={row.startTime} />
          <input type="hidden" name="endTime" value={row.endTime} />
          <p className="text-caption text-text-secondary m-0 px-0.5">
            Was this {row.range} stretch work? Your manager sees the answer, not a reason.
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              name="resolvedAction"
              value="KEPT"
              variant="primary"
              size="sm"
              disabled={pending}
            >
              Keep as work
            </Button>
            <Button
              type="submit"
              name="resolvedAction"
              value="DISCARDED"
              variant="secondary"
              size="sm"
              disabled={pending}
            >
              Discard
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
