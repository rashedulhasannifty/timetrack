'use server';

import { revalidatePath } from 'next/cache';
import { CreateTeamSchema, RenameTeamSchema } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';

/** Result of a team form, surfaced through useActionState. */
export interface TeamState {
  ok: boolean;
  message?: string;
}

/**
 * Create a team. A team is a manager's group, so this is the step that makes a new manager's
 * roster exist — without a second team there is nowhere to move anyone. The new team starts on
 * the default monitoring policy, which is then editable per team from the Settings tab.
 */
export async function createTeamAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const parsed = CreateTeamSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return { ok: false, message: 'Enter a team name (1–200 characters).' };

  try {
    await api.createTeam(session.accessToken, parsed.data);
    revalidatePath('/admin/teams');
    // The Users tab's team picker and its "N teams" count both read the same list.
    revalidatePath('/admin/users');
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not create the team.' };
  }
}

/**
 * Rename a team. Identity only — the monitoring policy is untouched, and the API audits the
 * two as separate actions (`team.rename` vs `team.update_settings`) so the record of who
 * changed what people are subject to stays legible.
 */
export async function renameTeamAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('teamId');
  if (typeof rawId !== 'string' || rawId.length === 0) {
    return { ok: false, message: 'No team selected.' };
  }
  const parsed = RenameTeamSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return { ok: false, message: 'Enter a team name (1–200 characters).' };

  try {
    await api.renameTeam(session.accessToken, rawId, parsed.data);
    revalidatePath('/admin/teams');
    revalidatePath('/admin/users');
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not rename the team.' };
  }
}
