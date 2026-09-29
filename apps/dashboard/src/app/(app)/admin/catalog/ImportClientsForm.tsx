'use client';

import { useState } from 'react';
import { parseNameList } from '@timetrack/contracts';
import { Button } from '../../../../components/ui/Button';
import { useToastAction } from '../../../../components/ui/useToastAction';
import { importClientsAction, type CatalogState } from './actions';
import { ImportResult } from './ImportResult';

const INITIAL: CatalogState = { ok: false };

/** Paste clients, pick their team, preview the count, import (spec §8.2). */
export function ImportClientsForm({ teams }: { teams: { id: string; name: string }[] }) {
  const [text, setText] = useState('');
  const [state, formAction, pending] = useToastAction(
    importClientsAction,
    INITIAL,
    (s) => s.message ?? 'Clients imported',
  );
  const count = parseNameList(text).length;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">Import clients — one per line, or paste a table</span>
        <textarea
          name="names"
          rows={6}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-body flex flex-col gap-1">
          <span className="text-text-secondary">Team</span>
          <select
            name="teamId"
            required
            defaultValue=""
            className="bg-surface border-separator text-text focus:border-accent text-label rounded-md border px-2 py-1.5 outline-none transition-colors"
          >
            <option value="" disabled>
              Pick a team
            </option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending || count === 0}>
          {pending ? 'Importing…' : `Import ${count} ${count === 1 ? 'client' : 'clients'}`}
        </Button>
      </div>
      <ImportResult state={state} />
    </form>
  );
}
