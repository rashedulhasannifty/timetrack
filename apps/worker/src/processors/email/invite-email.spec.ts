import { describe, it, expect } from 'vitest';
import { buildAcceptUrl, renderInviteEmail } from './invite-email.js';

const base = {
  name: 'New Hire',
  inviteToken: 'tok-123',
  expiresAt: '2026-08-17T00:00:00.000Z',
  appUrl: 'https://timer.niftyitsolution.com',
};

describe('buildAcceptUrl', () => {
  it('points at the dashboard accept page with the token as a query param', () => {
    expect(buildAcceptUrl('https://timer.niftyitsolution.com', 'tok-123')).toBe(
      'https://timer.niftyitsolution.com/accept-invite?token=tok-123',
    );
  });

  it('normalises a trailing slash on APP_URL rather than emitting //', () => {
    expect(buildAcceptUrl('https://timer.niftyitsolution.com/', 'tok-123')).toBe(
      'https://timer.niftyitsolution.com/accept-invite?token=tok-123',
    );
  });

  it('percent-encodes a token containing URL-significant characters', () => {
    // base64url never produces these, but the token is opaque to this function.
    expect(buildAcceptUrl('https://x.test', 'a+b/c=d&e')).toBe(
      'https://x.test/accept-invite?token=a%2Bb%2Fc%3Dd%26e',
    );
  });
});

describe('renderInviteEmail', () => {
  it('puts the accept link in both the text and HTML bodies', () => {
    const mail = renderInviteEmail(base);
    expect(mail.acceptUrl).toBe('https://timer.niftyitsolution.com/accept-invite?token=tok-123');
    expect(mail.text).toContain(mail.acceptUrl);
    expect(mail.html).toContain(mail.acceptUrl);
    expect(mail.subject).toBe('You have been invited to TimeTrack');
  });

  it('states the expiry date', () => {
    const mail = renderInviteEmail(base);
    expect(mail.text).toContain('Mon, 17 Aug 2026');
    expect(mail.html).toContain('Mon, 17 Aug 2026');
  });

  it('escapes HTML in the operator-supplied name', () => {
    const mail = renderInviteEmail({ ...base, name: '<script>alert(1)</script>' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    // The text body is not HTML, so it carries the name verbatim.
    expect(mail.text).toContain('<script>alert(1)</script>');
  });
});
