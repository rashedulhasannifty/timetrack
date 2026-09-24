import type { ClickUpMember } from './clickup-roster';

/** Where a ClickUp member stands here: signed up, holding an open invite, or neither. */
export type RosterStatus = 'not-invited' | 'invited' | 'has-account';

export interface RosterRow extends ClickUpMember {
  status: RosterStatus;
}

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Match the roster against existing users and open invites by email, ignoring case and stray
 * whitespace. An account wins over an invite: once someone has signed up, that is what matters.
 */
export function buildRosterRows(
  roster: readonly ClickUpMember[],
  users: ReadonlyArray<{ email: string }>,
  pending: ReadonlyArray<{ email: string }> = [],
): RosterRow[] {
  const known = new Set(users.map((u) => norm(u.email)));
  const invited = new Set(pending.map((p) => norm(p.email)));
  return roster.map((m) => {
    const email = norm(m.email);
    const status: RosterStatus = known.has(email)
      ? 'has-account'
      : invited.has(email)
        ? 'invited'
        : 'not-invited';
    return { ...m, status };
  });
}

export interface InviteOutcome {
  email: string;
  status: RosterStatus;
  /** Set when the invite did not go out and the status does not explain why. */
  error?: string;
}

/**
 * The two 409s the invite endpoint returns both mean "nothing left to do" — the person is
 * already invited or already has an account — so they resolve to a status, not an error.
 */
export function statusFromInviteError(status: number, message: string): RosterStatus | null {
  if (status !== 409) return null;
  return /pending/i.test(message) ? 'invited' : 'has-account';
}

/**
 * Invite each address in turn. Sequential on purpose: the API's global throttler allows 100
 * requests a minute, and firing the whole roster at once would trip it midway. One failure
 * never stops the rest.
 */
export async function inviteSequentially(
  emails: readonly string[],
  invite: (email: string) => Promise<void>,
  classify: (e: unknown) => { status: RosterStatus | null; message: string },
): Promise<InviteOutcome[]> {
  const out: InviteOutcome[] = [];
  for (const email of emails) {
    try {
      await invite(email);
      out.push({ email, status: 'invited' });
    } catch (e) {
      const { status, message } = classify(e);
      out.push(status ? { email, status } : { email, status: 'not-invited', error: message });
    }
  }
  return out;
}
