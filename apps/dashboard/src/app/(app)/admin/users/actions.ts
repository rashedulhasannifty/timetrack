'use server';

import { revalidatePath } from 'next/cache';
import { InviteUserSchema, EraseUserSchema, Role } from '@timetrack/contracts';
import { getSession } from '../../../../lib/session';
import { api, ApiError } from '../../../../lib/api-client';
import { CLICKUP_ROSTER } from './clickup-roster';
import { inviteSequentially, statusFromInviteError, type InviteOutcome } from './clickup-status';

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
  /** Set on success only, by setUserActiveAction — the toast text depends on it. */
  deactivated?: boolean;
}

/**
 * Invite a user into a chosen team. No name is collected here — the invitee supplies their
 * own on the accept page. The token stays server-side (getSession). The team comes
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
    role: formData.get('role'),
    teamId,
  });
  if (!parsed.success) {
    return { ok: false, message: 'Enter a valid email, a role, and a team.' };
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
    return { ok: true, deactivated };
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

/** Result of an invite from the ClickUp tab, one outcome per address. */
export interface RosterInviteState {
  ok: boolean;
  message?: string;
  outcomes?: InviteOutcome[];
}

/**
 * Invite one or more ClickUp members (the per-row button sends one, "Invite selected" several)
 * into a single role and team. Only addresses on the ClickUp roster are accepted, so this can't
 * become a way to invite arbitrary addresses in bulk. Invites go out one at a time, and a
 * failure on one address doesn't stop the rest.
 */
export async function inviteRosterAction(
  emails: string[],
  role: string,
  teamId: string,
): Promise<RosterInviteState> {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') return { ok: false, message: 'Not authorized.' };

  const onRoster = new Set(CLICKUP_ROSTER.map((m) => m.email.toLowerCase()));
  if (emails.length === 0 || !emails.every((e) => onRoster.has(e.toLowerCase()))) {
    return { ok: false, message: 'Pick people from the ClickUp list.' };
  }
  const parsed = emails.map((email) => InviteUserSchema.safeParse({ email, role, teamId }));
  const dtos = parsed.flatMap((p) => (p.success ? [p.data] : []));
  if (dtos.length !== emails.length) return { ok: false, message: 'Pick a role and a team.' };

  const outcomes = await inviteSequentially(
    dtos.map((d) => d.email),
    async (email) => {
      await api.inviteUser(session.accessToken, { ...dtos[0]!, email });
    },
    (e) =>
      e instanceof ApiError
        ? { status: statusFromInviteError(e.status, e.message), message: e.message }
        : { status: null, message: 'Could not send the invite.' },
  );
  revalidatePath('/admin/users');
  return { ok: outcomes.every((o) => !o.error), outcomes };
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
