'use client';

import { useEffect } from 'react';
import { useToast } from './Toast';

/**
 * Raises a toast (tone `good`) once for each successful Server Action submission.
 *
 * A Server Action cannot call `useToast` itself (see Toast.tsx), so the client form component
 * that owns the `useActionState` result raises it here. `useActionState` hands back a fresh
 * state object on every submission — including the initial `{ ok: false }` and every rejected
 * one, which stay inline exactly as before — so keying the effect on `state` fires the toast
 * once per successful submit, never on mount, and never twice for one submission. Errors are
 * deliberately not toasted: they are already shown inline, and a toast would report the same
 * failure twice.
 */
export function useResultToast<S extends { ok: boolean }>(
  state: S,
  message: string | ((state: S) => string),
): void {
  const push = useToast();

  useEffect(() => {
    if (!state.ok) return;
    push(typeof message === 'function' ? message(state) : message);
    // Keyed on `state` alone, per the contract above: `push` is a stable context value and a
    // literal `message` never changes, so neither belongs in the dependency list, and a
    // function `message` re-evaluating on its own must not re-fire a toast for the same submit.
  }, [state]);
}
