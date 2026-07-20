'use server';

import { revalidatePath } from 'next/cache';
import { DecisionSchema } from '@timetrack/contracts';
import { getSession } from '../../../lib/session';
import { api, ApiError } from '../../../lib/api-client';

/** Result of a decide (approve/flag) action, surfaced through useActionState. */
export interface DecideState {
  ok: boolean;
  message?: string;
}

/**
 * Approve or flag a timesheet. The reviewer's access token is read from the server-side
 * session (getSession) — it never travels through the form. `status`/`note` are validated
 * through DecisionSchema before the request; the API re-validates and re-checks
 * ResourceAccessService (403 for a manager outside their team), which we surface as a message
 * rather than throwing.
 */
export async function decideAction(_prev: DecideState, formData: FormData): Promise<DecideState> {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('id');
  const id = typeof rawId === 'string' ? rawId : '';
  const rawNote = formData.get('note');
  const note = typeof rawNote === 'string' && rawNote.trim().length > 0 ? rawNote : undefined;

  const parsed = DecisionSchema.safeParse({ status: formData.get('status'), note });
  if (!id || !parsed.success) return { ok: false, message: 'Invalid decision.' };

  try {
    await api.decideApproval(session.accessToken, id, parsed.data);
    revalidatePath('/approvals');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof ApiError ? e.message : 'Could not save the decision.',
    };
  }
}
