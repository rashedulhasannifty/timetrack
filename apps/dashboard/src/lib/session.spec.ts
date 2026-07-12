import { describe, it, expect, beforeEach, vi } from 'vitest';

const cookieStore = { value: undefined as string | undefined };
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (cookieStore.value ? { name, value: cookieStore.value } : undefined),
    }),
}));

import { getSession } from './session';
import { encryptSession } from './session-cookie';

const CLAIMS = {
  sub: '019797a0-0000-7000-8000-0000000000aa',
  role: 'ADMIN',
  teamId: '019797a0-0000-7000-8000-000000000001',
};

function makeJwt(claims: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.signature-not-verified-dashboard-side`;
}

beforeEach(() => {
  process.env.DASHBOARD_SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
  cookieStore.value = undefined;
});

describe('getSession', () => {
  it('returns null when there is no cookie', async () => {
    expect(await getSession()).toBeNull();
  });

  it('returns null when the access token is expired', async () => {
    cookieStore.value = encryptSession({
      accessToken: makeJwt(CLAIMS),
      refreshToken: 'r',
      accessExpiresAt: Date.now() - 1000,
    });
    expect(await getSession()).toBeNull();
  });

  it('returns null when the JWT claims fail the contract schema', async () => {
    cookieStore.value = encryptSession({
      accessToken: makeJwt({ sub: 'not-a-uuid', role: 'ADMIN', teamId: 'x' }),
      refreshToken: 'r',
      accessExpiresAt: Date.now() + 60_000,
    });
    expect(await getSession()).toBeNull();
  });

  it('returns {userId, role, accessToken} for a valid session', async () => {
    const accessToken = makeJwt(CLAIMS);
    cookieStore.value = encryptSession({
      accessToken,
      refreshToken: 'r',
      accessExpiresAt: Date.now() + 60_000,
    });
    expect(await getSession()).toEqual({ userId: CLAIMS.sub, role: 'ADMIN', accessToken });
  });
});
