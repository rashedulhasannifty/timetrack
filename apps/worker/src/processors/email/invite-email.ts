/**
 * Invite email rendering — pure, so it is unit-testable without SES or a queue.
 * The accept link is the whole point of the message: it carries the one-time token to the
 * dashboard's /accept-invite page, which POSTs it to the API's /v1/auth/accept-invite.
 */

export interface InviteEmailInput {
  /** The invited person's name, as the admin typed it. Untrusted — escaped for HTML. */
  name: string;
  /** The RAW one-time token. Only the SHA-256 hash is stored; this is the bearer secret. */
  inviteToken: string;
  /** ISO-8601 expiry, computed and persisted at create time. */
  expiresAt: string;
  /** The dashboard's public origin (APP_URL). */
  appUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  /** Exposed separately so the unconfigured-SES path can log it in development. */
  acceptUrl: string;
}

/** Minimal HTML entity escaping — the name is operator-supplied free text. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildAcceptUrl(appUrl: string, inviteToken: string): string {
  // Trailing slashes on APP_URL are an easy operator slip; normalise rather than emit `//`.
  return `${appUrl.replace(/\/+$/, '')}/accept-invite?token=${encodeURIComponent(inviteToken)}`;
}

export function renderInviteEmail(input: InviteEmailInput): RenderedEmail {
  const acceptUrl = buildAcceptUrl(input.appUrl, input.inviteToken);
  const expires = new Date(input.expiresAt).toUTCString();
  const subject = 'You have been invited to TimeTrack';

  const text = [
    `Hi ${input.name},`,
    '',
    'You have been invited to join TimeTrack. Open the link below to set your password',
    'and finish setting up your account:',
    '',
    acceptUrl,
    '',
    `This link can only be used once and expires on ${expires}.`,
    'If you were not expecting this invitation you can ignore this email.',
  ].join('\n');

  const html = [
    '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">',
    `<p>Hi ${escapeHtml(input.name)},</p>`,
    '<p>You have been invited to join TimeTrack. Use the button below to set your password and finish setting up your account.</p>',
    `<p><a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Accept invitation</a></p>`,
    `<p style="font-size:13px;color:#555">Or paste this link into your browser:<br><span>${escapeHtml(acceptUrl)}</span></p>`,
    `<p style="font-size:13px;color:#555">This link can only be used once and expires on ${escapeHtml(expires)}. If you were not expecting this invitation you can ignore this email.</p>`,
    '</body></html>',
  ].join('');

  return { subject, text, html, acceptUrl };
}
