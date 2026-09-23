'use client';

import { useActionState } from 'react';
import { useToast } from './Toast';

/**
 * `useActionState`, plus a toast (tone `good`) raised when the action succeeds.
 *
 * This is NOT a `useEffect` keyed on the returned state — an earlier version was, and it
 * silently dropped exactly the toasts that mattered most. A successful action commonly
 * `revalidatePath`s a page whose new RSC tree no longer includes this form's row: approve/flag
 * removes it from the Pending tab, delete removes the entry row, an archive toggle hides
 * itself once archived, erase removes the whole row. React can commit that new tree in the
 * SAME transition that delivers the action's `{ ok: true }` result, unmounting the form before
 * an effect watching that state ever gets to run — so the toast never fired.
 *
 * Pushing from inside the action wrapper instead runs synchronously while the action is still
 * being awaited, before React decides what the new tree even looks like, let alone commits it.
 * `push` comes from `ToastProvider`, mounted once in the `(app)` layout, so it is still valid
 * after this component — whose own `useToast()` call would otherwise unmount right along with
 * it — is gone.
 */
export function useToastAction<S extends { ok: boolean }>(
  action: (state: S, formData: FormData) => S | Promise<S>,
  initialState: S,
  message: string | ((state: S) => string),
): [S, (formData: FormData) => void, boolean] {
  const push = useToast();

  // React types useActionState's action as `(state: Awaited<State>, payload) => State`, so it
  // can support a State that is itself a thenable. Our S never is — it is always the plain
  // `{ ok: boolean; ... }` result object an action returns — but TypeScript can't prove that for
  // a generic S, so `initialState` needs one explicit cast to line up with `Awaited<S>`.
  const toastAction = async (prevState: Awaited<S>, formData: FormData): Promise<S> => {
    const result = await action(prevState, formData);
    if (result.ok) push(typeof message === 'function' ? message(result) : message);
    return result;
  };

  const [state, dispatch, pending] = useActionState(toastAction, initialState as Awaited<S>);
  return [state, dispatch, pending];
}
