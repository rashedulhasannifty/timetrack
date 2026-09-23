'use client';

import { useEffect } from 'react';
import { useToastAction } from '../../../components/ui/useToastAction';
import { decideAction, type DecideState } from './actions';
import { decideToastMessage } from './decide-toast';
import { DecideFields } from './DecideFields';

const INITIAL: DecideState = { ok: false };

/**
 * The week drawer's inline decide controls (footer of `ApprovalsTable`'s `Drawer`). Uses the
 * same `decideAction` + toast as the row's popover (`DecideForm`), and additionally closes the
 * drawer on success.
 *
 * `Drawer` unmounts its footer whenever `open` is false, so a fresh instance of this component
 * — and a fresh `useActionState` — is created every time the drawer opens. That makes the
 * close effect below safe to key on `state` alone: this component can only ever see ONE
 * successful submission in its lifetime, so there is no stale "ok" left over from a previously
 * open row for a later render to react to.
 */
export function DrawerDecideForm({
  approvalId,
  onDecided,
}: {
  approvalId: string;
  onDecided: () => void;
}) {
  const [state, formAction, pending] = useToastAction(decideAction, INITIAL, decideToastMessage);

  useEffect(() => {
    if (state.ok) onDecided();
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <DecideFields approvalId={approvalId} pending={pending} message={state.message} />
    </form>
  );
}
