'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { Project } from '@timetrack/contracts';
import { Button } from '../ui/Button';
import { EntryFormFields } from './EntryFormFields';
import { createManualEntryAction, type EntryFormState } from '../../app/(app)/me/actions';

const INITIAL: EntryFormState = { ok: false };

/**
 * "Add time" for a day — the answer to forgetting to hit Start, or working somewhere the Mac
 * app was not.
 *
 * A disclosure rather than an always-open form: the overwhelmingly common case is that the
 * tracked day is already correct, and a permanently visible set of time fields would invite
 * hand-entry over actually running the timer. Client component so a rejection from the API
 * ("overlaps another entry") lands inline instead of throwing; the token stays server-side.
 */
export function AddTimeEntryForm({
  day,
  projects,
  userId,
}: {
  day: string;
  projects: Project[];
  /** Whose day this is. Omitted on /me — the API attributes an absent userId to the caller. */
  userId?: string;
}) {
  const [state, formAction, pending] = useActionState(createManualEntryAction, INITIAL);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Collapse once the entry lands, so the list behind it is what you see next.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="border-separator text-text-secondary hover:text-text text-caption cursor-pointer rounded-full border px-[14px] py-[5px] font-bold"
        >
          {open ? 'Cancel' : 'Add time'}
        </button>
      </div>
      {open ? (
        <form
          action={formAction}
          className="bg-surface-raised border-separator flex flex-col gap-2.5 rounded-[14px] border p-3"
        >
          {userId ? <input type="hidden" name="userId" value={userId} /> : null}
          <EntryFormFields
            projects={projects}
            defaults={{ day, start: '09:00', end: '17:00', projectId: null, note: '' }}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? 'Adding…' : 'Add entry'}
            </Button>
            {state.message ? (
              <span className="text-destructive text-caption">{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
