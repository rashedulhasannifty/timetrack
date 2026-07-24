import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * PRD §6.8 (slice 4.4) — the transient SSO handshake state (`state`, `nonce`, PKCE
 * `codeVerifier`) lives in ONE short-lived httpOnly, AES-256-GCM-encrypted cookie between
 * `sso/start` and `sso/callback`. Same crypto as the session cookie, different name and a
 * ~2-minute lifetime — it exists only for the duration of the redirect round-trip.
 *
 * No Next imports here so it stays a pure, unit-testable unit. Nothing here is ever logged.
 */
export const OIDC_COOKIE = 'tt_oidc';

// The handshake must complete within this window; a stale cookie is treated as no cookie.
export const OIDC_MAX_AGE_SECONDS = 120;

export interface OidcCookiePayload {
  state: string;
  nonce: string;
  codeVerifier: string;
}

function key(): Buffer {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DASHBOARD_SESSION_SECRET must be set and at least 32 characters');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptOidcState(payload: OidcCookiePayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${Buffer.concat([ciphertext, tag]).toString('base64url')}`;
}

export function decryptOidcState(raw: string | undefined): OidcCookiePayload | null {
  if (!raw) return null;
  try {
    const [ivPart, bodyPart] = raw.split('.');
    if (!ivPart || !bodyPart) return null;
    const iv = Buffer.from(ivPart, 'base64url');
    const body = Buffer.from(bodyPart, 'base64url');
    if (body.length <= 16) return null; // need ciphertext + 16-byte GCM tag
    const ciphertext = body.subarray(0, body.length - 16);
    const tag = body.subarray(body.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as OidcCookiePayload).state !== 'string' ||
      typeof (parsed as OidcCookiePayload).nonce !== 'string' ||
      typeof (parsed as OidcCookiePayload).codeVerifier !== 'string'
    ) {
      return null;
    }
    return parsed as OidcCookiePayload;
  } catch {
    return null;
  }
}

export function oidcCookieAttributes(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    // Secure requires HTTPS; disable in dev so the flow works over http://localhost.
    secure: process.env.NODE_ENV === 'production',
    // 'lax' lets the cookie ride the top-level GET redirect back from the IdP.
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}
