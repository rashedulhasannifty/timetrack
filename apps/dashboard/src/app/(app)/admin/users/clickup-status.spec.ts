import { describe, it, expect } from 'vitest';
import { CLICKUP_ROSTER } from './clickup-roster';
import { buildRosterRows, inviteSequentially, statusFromInviteError } from './clickup-status';

const member = (email: string) => ({ name: email, email, clickupId: '1' });

describe('CLICKUP_ROSTER', () => {
  it('holds all 39 members, each with a distinct email', () => {
    expect(CLICKUP_ROSTER).toHaveLength(39);
    expect(new Set(CLICKUP_ROSTER.map((m) => m.email.toLowerCase())).size).toBe(39);
  });
});

describe('buildRosterRows', () => {
  it('marks a member with an account regardless of email case or whitespace', () => {
    const rows = buildRosterRows(
      [member('Ada@Example.com'), member('bob@example.com')],
      [{ email: ' ada@example.com ' }],
    );
    expect(rows.map((r) => r.status)).toEqual(['has-account', 'not-invited']);
  });

  it('marks an open invite as invited, but an account outranks it', () => {
    const rows = buildRosterRows(
      [member('ada@example.com'), member('Bob@Example.com'), member('cy@example.com')],
      [{ email: 'ada@example.com' }],
      [{ email: 'ada@example.com' }, { email: 'bob@example.com' }],
    );
    expect(rows.map((r) => r.status)).toEqual(['has-account', 'invited', 'not-invited']);
  });
});

describe('statusFromInviteError', () => {
  it('reads a pending-invite 409 as invited', () => {
    expect(statusFromInviteError(409, 'An invitation for this email is already pending')).toBe(
      'invited',
    );
  });
  it('reads an email-in-use 409 as has-account', () => {
    expect(statusFromInviteError(409, 'A user with this email already exists')).toBe('has-account');
  });
  it('leaves any other failure as an error', () => {
    expect(statusFromInviteError(422, 'Team not found')).toBeNull();
  });
});

describe('inviteSequentially', () => {
  it('keeps going past a failure and reports each address', async () => {
    const calls: string[] = [];
    const out = await inviteSequentially(
      ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
      (email) => {
        calls.push(email);
        if (email === 'b@x.com') return Promise.reject(new Error('pending'));
        if (email === 'c@x.com') return Promise.reject(new Error('boom'));
        return Promise.resolve();
      },
      (e) => {
        const message = (e as Error).message;
        return { status: message === 'pending' ? 'invited' : null, message };
      },
    );
    expect(calls).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
    expect(out).toEqual([
      { email: 'a@x.com', status: 'invited' },
      { email: 'b@x.com', status: 'invited' },
      { email: 'c@x.com', status: 'not-invited', error: 'boom' },
      { email: 'd@x.com', status: 'invited' },
    ]);
  });

  it('never has two invites in flight at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await inviteSequentially(
      ['a@x.com', 'b@x.com', 'c@x.com'],
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
      () => ({ status: null, message: '' }),
    );
    expect(peak).toBe(1);
  });
});
