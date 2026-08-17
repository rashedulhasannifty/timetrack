'use client';

import { useActionState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { createTeamAction, type TeamState } from './actions';

const INITIAL: TeamState = { ok: false };

/**
 * Create a team. A team is a manager's group, so this is the step that makes a new manager's
 * roster exist — without a second team there is nowhere to move anyone. The new team starts on
 * the default monitoring policy; it is edited per team from Admin → Settings.
 */
export function CreateTeamForm() {
  const [state, formAction, pending] = useActionState(createTeamAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="text-body flex flex-col gap-1">
        <span className="text-text-secondary">New team</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="Support"
          className="bg-surface border-separator text-text focus:border-accent rounded-md border px-3 py-2 outline-none transition-colors"
        />
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Creating…' : 'Create team'}
      </Button>
      {state.message ? (
        <p className="text-destructive text-body w-full" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
