'use client';

import { useState } from 'react';
import { parseNameList } from '@timetrack/contracts';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { addWorkTypesAction, type CatalogState } from './actions';
import { ImportResult } from './ImportResult';

const INITIAL: CatalogState = { ok: false };

/** Paste box for new catalog entries; the count previews exactly what the server will receive. */
export function AddWorkTypesForm() {
  const [text, setText] = useState('');
  const [state, formAction, pending] = useToastAction(
    addWorkTypesAction,
    INITIAL,
    (s) => s.message ?? 'Work types added',
  );
  const count = parseNameList(text).length;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Add work types — one per line</span>
        <textarea
          name="names"
          rows={4}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder={'Bookkeeping\nPayroll\nVAT/TAX Filling'}
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <div>
        <Button type="submit" variant="secondary" disabled={pending || count === 0}>
          {pending ? 'Adding…' : `Add ${count} ${count === 1 ? 'work type' : 'work types'}`}
        </Button>
      </div>
      <ImportResult state={state} />
    </form>
  );
}
