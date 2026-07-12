import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSession, decryptSession, type SessionPayload } from './session-cookie';

const PAYLOAD: SessionPayload = {
  accessToken: 'header.payload.sig',
  refreshToken: 'refresh-token-value',
  accessExpiresAt: 1_800_000_000_000,
};

beforeEach(() => {
  process.env.DASHBOARD_SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
});

describe('session cookie crypto', () => {
  it('round-trips a payload', () => {
    expect(decryptSession(encryptSession(PAYLOAD))).toEqual(PAYLOAD);
  });

  it('returns null for empty/undefined/garbage input', () => {
    expect(decryptSession(undefined)).toBeNull();
    expect(decryptSession('')).toBeNull();
    expect(decryptSession('not-a-valid-blob')).toBeNull();
  });

  it('returns null when the ciphertext is tampered', () => {
    const [iv, body] = encryptSession(PAYLOAD).split('.');
    const bytes = Buffer.from(body, 'base64url');
    bytes[0] ^= 0xff;
    expect(decryptSession(`${iv}.${bytes.toString('base64url')}`)).toBeNull();
  });

  it('returns null when decrypted under a different secret', () => {
    const raw = encryptSession(PAYLOAD);
    process.env.DASHBOARD_SESSION_SECRET = 'a-totally-different-32-char-secret!!!';
    expect(decryptSession(raw)).toBeNull();
  });

  it('throws when the secret is missing or too short', () => {
    delete process.env.DASHBOARD_SESSION_SECRET;
    expect(() => encryptSession(PAYLOAD)).toThrow(/DASHBOARD_SESSION_SECRET/);
    process.env.DASHBOARD_SESSION_SECRET = 'too-short';
    expect(() => encryptSession(PAYLOAD)).toThrow(/DASHBOARD_SESSION_SECRET/);
  });
});
