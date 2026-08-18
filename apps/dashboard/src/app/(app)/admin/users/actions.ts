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
 * Invite a user into a chosen team. The token stays server-side (getSession). The team comes
 * from the form now: teams are the unit of management, so hiring straight into a manager's team
 * is the normal case — the alternative was inviting into the admin's own team and immediately
 * moving the person out. Falls back to the admin's own team if the field is absent. The API
 * re-checks ADMIN and that the destination team exists.
 */
export async function inviteUserAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawTeam = formData.get('teamId');
  const teamId =
    typeof rawTeam === 'string' && rawTeam.length > 0
      ? rawTeam
      : (await api.getCurrentTeam(session.accessToken)).id;
  const parsed = InviteUserSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    teamId,
  });
  if (!parsed.success) {
    return { ok: false, message: 'Enter a name, a valid email, a role, and a team.' };
  }

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
 * Move a user to another team — i.e. hand them to a different manager. This is a permissions
 * change, not a field edit: the old team's managers lose sight of that person's history and the
 * new team's gain it. The API audits it (`user.team_change`) and 422s an unknown team.
 */
export async function setUserTeamAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const rawId = formData.get('userId');
  const rawTeam = formData.get('teamId');
  const id = typeof rawId === 'string' ? rawId : '';
  if (typeof rawTeam !== 'string' || rawTeam.length === 0) {
    return { ok: false, message: 'Pick a team.' };
  }

  try {
    await api.setUserTeam(session.accessToken, id, rawTeam);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : 'Update failed.' };
  }
}

// Team create/rename live in ../teams/actions.ts, next to the surface that owns them.

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
