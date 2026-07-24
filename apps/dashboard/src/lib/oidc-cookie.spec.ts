import { describe, it, expect, beforeEach } from 'vitest';
import { encryptOidcState, decryptOidcState } from './oidc-cookie';

beforeEach(() => {
  process.env.DASHBOARD_SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
});

const payload = { state: 'st', nonce: 'no', codeVerifier: 've-1234567890' };

describe('oidc-cookie', () => {
  it('round-trips a handshake payload', () => {
    expect(decryptOidcState(encryptOidcState(payload))).toEqual(payload);
  });

  it('returns null for a missing cookie', () => {
    expect(decryptOidcState(undefined)).toBeNull();
  });

  it('returns null for a tampered ciphertext (GCM auth tag fails)', () => {
    const enc = encryptOidcState(payload);
    const parts = enc.split('.');
    const iv = parts[0] ?? '';
    const flipped = Buffer.from(parts[1] ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    expect(decryptOidcState(`${iv}.${flipped.toString('base64url')}`)).toBeNull();
  });

  it('returns null for a malformed value', () => {
    expect(decryptOidcState('not-a-cookie')).toBeNull();
  });
});
