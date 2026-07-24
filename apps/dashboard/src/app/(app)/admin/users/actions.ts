'use server';

import { revalidatePath } from 'next/cache';
import { InviteUserSchema, EraseUserSchema, Role } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';

/** Result of the invite form, surfaced through useActionState. */
export interface InviteState {
  ok: boolean;
  message?: string;
  /** Dev-only: the raw invite token, present only when the API runs in development. */
  devToken?: string;
}

/** Result of a per-row deactivate/reactivate toggle, surfaced through useActionState. */
export interface RowState {
  ok: boolean;
  message?: string;
}

/**
 * Invite a user into the admin's OWN team. The token stays server-side (getSession); teamId is
 * taken from the admin's current team, never from the form, so the form can't target another
 * team (the API re-enforces this with a 403 regardless).
 */
export async function inviteUserAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const team = await api.getCurrentTeam(session.accessToken);
  const parsed = InviteUserSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    teamId: team.id,
  });
  if (!parsed.success) return { ok: false, message: 'Enter a name, a valid email, and a role.' };

  try {
    const result = await api.inviteUser(session.accessToken, parsed.data);
    revalidatePath('/admin/users');
    return {
      ok: true,
      message: `Invited ${result.invite.email}.`,
      ...(result.devToken ? { devToken: result.devToken } : {}),
    };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Could not send the invite.' };
  }
}

/**
 * Deactivate (revokes the user's refresh tokens server-side) or reactivate a user. The API
 * rejects self-deactivation and removing the last active admin (409); those titles are shown
 * inline via the returned message.
 */
export async function setUserActiveAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('userId');
  const id = typeof rawId === 'string' ? rawId : '';
  const deactivated = formData.get('deactivated') === 'true';

  try {
    await api.setUserActive(session.accessToken, id, deactivated);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

/**
 * Change a user's role (slice 4.5). The API re-enforces the guardrails (cross-team 403,
 * self-role-change 409, demoting the last active admin 409); those titles surface inline.
 */
export async function setUserRoleAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('userId');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = Role.safeParse(formData.get('role'));
  if (!parsed.success) return { ok: false, message: 'Invalid role.' };

  try {
    await api.setUserRole(session.accessToken, id, parsed.data);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

/**
 * PRD §4.4 — erase a user's data. The API enforces the same rules again (cross-team 403,
 * self-erase 409, last-active-admin 409); those problem+json titles surface inline.
 */
export async function eraseUserAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('userId');
  const id = typeof rawId === 'string' ? rawId : '';
  const parsed = EraseUserSchema.safeParse({ reason: formData.get('reason') });
  if (!parsed.success) return { ok: false, message: 'A reason is required (max 500 chars).' };

  try {
    await api.eraseUser(session.accessToken, id, parsed.data);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Erase failed.' };
  }
}
