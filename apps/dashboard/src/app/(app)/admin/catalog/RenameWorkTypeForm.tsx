'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { renameWorkTypeAction, type CatalogState } from './actions';

const INITIAL: CatalogState = { ok: false };

/** Inline rename, idle until clicked — the RenameTeamForm pattern (see its comments). */
export function RenameWorkTypeForm({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useToastAction(
    renameWorkTypeAction,
    INITIAL,
    'Work type renamed',
  );
  const [editing, setEditing] = useState(false);

  // Collapse once the server sends back a different name, so the next open shows the new one.
  useEffect(() => {
    setEditing(false);
  }, [name]);

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
      <input type="hidden" name="id" value={id} />
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
      {state.message && !state.ok ? (
        <p className="text-destructive text-caption w-full text-right" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
