'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Project } from '@timetrack/contracts';
import { Button } from '../ui/Button';
import { EntryFormFields } from './EntryFormFields';
import {
  deleteEntryAction,
  updateEntryAction,
  type EntryFormState,
} from '../../app/(app)/me/actions';
import type { DayEntryRow } from '../../lib/person-day-view';

const INITIAL: EntryFormState = { ok: false };

/**
 * Edit and delete for one entry.
 *
 * Delete is a two-step disclosure, not a one-click button and not a browser `confirm()`: the
 * API keeps the whole deleted row in the audit log, so an admin can reconstruct it, but there
 * is no undo from here — and a misclick on a row in a list is exactly the mistake a bare
 * button invites. Edit reuses the same fields as the add form so the two cannot diverge.
 *
 * A RUNNING entry offers neither. Its end has not happened yet, so there is nothing coherent
 * to edit to, and the Mac app owns closing it.
 */
export function EntryRowActions({
  entry,
  day,
  projects,
  userId,
}: {
  entry: DayEntryRow;
  day: string;
  projects: Project[];
  userId?: string;
}) {
  const [mode, setMode] = useState<'closed' | 'edit' | 'confirm-delete'>('closed');
  const [editState, editAction, editPending] = useActionState(updateEntryAction, INITIAL);
  const [deleteState, deleteFormAction, deletePending] = useActionState(deleteEntryAction, INITIAL);

  useEffect(() => {
    if (editState.ok) setMode('closed');
  }, [editState.ok]);

  if (entry.running) return null;

  return (
    <div className="flex flex-none flex-col items-end gap-1.5">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'edit' ? 'closed' : 'edit'))}
          aria-expanded={mode === 'edit'}
          className="border-separator text-text-secondary hover:text-text text-caption cursor-pointer rounded-full border px-3 py-[3px] font-bold"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'confirm-delete' ? 'closed' : 'confirm-delete'))}
          aria-expanded={mode === 'confirm-delete'}
          className="border-separator text-text-secondary hover:text-destructive text-caption cursor-pointer rounded-full border px-3 py-[3px] font-bold"
        >
          Delete
        </button>
      </div>

      {mode === 'confirm-delete' ? (
        <form action={deleteFormAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={entry.id} />
          {userId ? <input type="hidden" name="userId" value={userId} /> : null}
          <span className="text-caption text-text-secondary">Delete this entry?</span>
          <Button type="submit" variant="secondary" size="sm" disabled={deletePending}>
            {deletePending ? 'Deleting…' : 'Yes, delete'}
          </Button>
          {deleteState.message ? (
            <span className="text-destructive text-caption">{deleteState.message}</span>
          ) : null}
        </form>
      ) : null}

      {mode === 'edit' ? (
        <form
          action={editAction}
          className="bg-surface-raised border-separator flex w-[320px] flex-col gap-2.5 rounded-[14px] border p-3 text-left"
        >
          <input type="hidden" name="id" value={entry.id} />
          {userId ? <input type="hidden" name="userId" value={userId} /> : null}
          <EntryFormFields
            projects={projects}
            defaults={{
              day,
              start: entry.startClock,
              end: entry.endClock ?? entry.startClock,
              projectId: entry.projectId,
              note: entry.note ?? '',
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={editPending}>
              {editPending ? 'Saving…' : 'Save'}
            </Button>
            {editState.message ? (
              <span className="text-destructive text-caption">{editState.message}</span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
