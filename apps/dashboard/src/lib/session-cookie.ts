import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * PRD §7.6 — the whole session lives in ONE httpOnly, AES-256-GCM-encrypted cookie.
 * This module is the only place that knows the cookie name, payload shape, and crypto.
 * No Next imports here so it stays a pure, unit-testable unit. Nothing here is ever logged.
 */
export const SESSION_COOKIE = 'tt_session';

// 30 days — mirrors the API's default REFRESH_TOKEN_TTL. The dashboard does not read the
// API's env; if that default changes, change this constant.
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  /** epoch ms at which the access token expires. */
  accessExpiresAt: number;
}

function key(): Buffer {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('DASHBOARD_SESSION_SECRET must be set and at least 32 characters');
  }
  // SHA-256 → a fixed 32-byte key for aes-256-gcm.
  return createHash('sha256').update(secret).digest();
}

export function encryptSession(payload: SessionPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${Buffer.concat([ciphertext, tag]).toString('base64url')}`;
}

export function decryptSession(raw: string | undefined): SessionPayload | null {
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
      typeof (parsed as SessionPayload).accessToken !== 'string' ||
      typeof (parsed as SessionPayload).refreshToken !== 'string' ||
      typeof (parsed as SessionPayload).accessExpiresAt !== 'number'
    ) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

export function sessionCookieAttributes(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    // Secure requires HTTPS; disable in dev so login works over http://localhost.
    // Production is TLS-only (PRD §8), so the cookie is Secure there.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}
