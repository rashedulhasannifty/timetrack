'use client';

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { decideAction, type DecideState } from './actions';
import { decidePlacement, type Placement } from './decide-placement';

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLFormElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Measure once the popover is in the DOM, then position it. It renders `invisible` until a
  // placement exists, so the pre-measurement frame is never seen.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const place = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      const popover = popoverRef.current?.getBoundingClientRect();
      if (!button || !popover) return;
      setPlacement(
        decidePlacement({
          button,
          popover: { width: popover.width, height: popover.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      );
    };
    place();
    window.addEventListener('resize', place);
    // Capture phase: the page, not just the window, may be what scrolled. A fixed popover does
    // not move with its button, so it has to be told.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

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
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-surface-raised border-separator text-accent text-caption cursor-pointer rounded-full border px-[13px] py-[5px] font-bold"
      >
        Decide
      </button>
      {open ? (
        <form
          ref={popoverRef}
          action={formAction}
          style={placement ? { top: placement.top, left: placement.left } : undefined}
          // FIXED, not absolute: the approvals table sits in a Card with `overflow-hidden`, which
          // cropped an absolutely positioned popover on the last (or only) row — there is no card
          // left below those rows for it to open into. See decide-placement.ts.
          className={`bg-surface-raised border-separator shadow-e2 fixed z-50 flex w-[220px] flex-col gap-2 rounded-[10px] border p-2 ${
            placement ? '' : 'invisible'
          }`}
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
