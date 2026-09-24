import type { ClickUpMember } from './clickup-roster';

/**
 * Where a ClickUp member stands here. `invited` is only ever known for this session: there is
 * no endpoint that lists pending invites, so it comes from an invite this page just sent, or
 * from the API refusing a second one because an invite is already pending.
 */
export type RosterStatus = 'not-invited' | 'invited' | 'has-account';

export interface RosterRow extends ClickUpMember {
  status: RosterStatus;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Match the roster against existing users by email, ignoring case and stray whitespace. */
export function buildRosterRows(
  roster: readonly ClickUpMember[],
  users: ReadonlyArray<{ email: string }>,
): RosterRow[] {
  const known = new Set(users.map((u) => norm(u.email)));
  return roster.map((m) => ({
    ...m,
    status: known.has(norm(m.email)) ? 'has-account' : 'not-invited',
  }));
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
