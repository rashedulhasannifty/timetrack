'use client';

import { useActionState, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { renameTeamAction, type TeamState } from './actions';

const INITIAL: TeamState = { ok: false };

/**
 * Inline rename, one per row. Idle until the admin clicks Rename, so the table reads as a list
 * of teams rather than a wall of text inputs — and an accidental keystroke in a row cannot
 * change what a team is called.
 */
export function RenameTeamForm({ teamId, name }: { teamId: string; name: string }) {
  const [state, formAction, pending] = useActionState(renameTeamAction, INITIAL);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors"
      >
        Rename
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="teamId" value={teamId} />
      <input
        name="name"
        defaultValue={name}
        required
        maxLength={200}
        aria-label={`New name for ${name}`}
        className="bg-surface border-separator text-text focus:border-accent text-label w-44 rounded-md border px-2.5 py-1.5 outline-none transition-colors"
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-label text-text-secondary hover:text-text cursor-pointer transition-colors"
      >
        Cancel
      </button>
      {state.message ? (
        <p className="text-destructive text-caption w-full text-right" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
