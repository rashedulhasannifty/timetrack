import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession, SESSION_COOKIE } from '../../../lib/session-cookie';

vi.mock('../../../lib/api-client', () => ({
  api: { refresh: vi.fn() },
}));

import { GET } from './[...auth]/route';
import { api } from '../../../lib/api-client';

// A signed-shape JWT the dashboard only decodes (never verifies).
function makeJwt(claims: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

const VALID_CLAIMS = {
  sub: '019797a0-0000-7000-8000-0000000000aa',
  role: 'ADMIN',
  teamId: '019797a0-0000-7000-8000-000000000001',
};

function refreshRequest(): NextRequest {
  const cookie = encryptSession({ accessToken: 'x', refreshToken: 'r', accessExpiresAt: 0 });
  const req = new NextRequest('http://localhost:3000/api/auth/refresh', {
    headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
  });
  return req;
}

const ctx = { params: Promise.resolve({ auth: ['refresh'] }) };

beforeEach(() => {
  process.env.DASHBOARD_SESSION_SECRET = 'test-secret-at-least-32-chars-long!!';
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/auth/refresh loop-breaker', () => {
  it('redirects to / when the reissued token has valid claims', async () => {
    vi.mocked(api.refresh).mockResolvedValue({
      accessToken: makeJwt(VALID_CLAIMS),
      refreshToken: 'r2',
      expiresIn: 900,
    });
    const res = await GET(refreshRequest(), ctx);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });

  it('falls through to /login when the reissued token still fails to decode', async () => {
    vi.mocked(api.refresh).mockResolvedValue({
      accessToken: makeJwt({ sub: 'not-a-uuid', role: 'ADMIN', teamId: 'x' }),
      refreshToken: 'r2',
      expiresIn: 900,
    });
    const res = await GET(refreshRequest(), ctx);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });
});
