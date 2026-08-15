import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession, SESSION_COOKIE, decryptSession } from '../../../lib/session-cookie';
import { encryptOidcState, OIDC_COOKIE } from '../../../lib/oidc-cookie';

vi.mock('../../../lib/api-client', () => ({
  api: { refresh: vi.fn(), oidcAuthorize: vi.fn(), oidcCallback: vi.fn() },
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
  it('redirects to /overview when the reissued token has valid claims', async () => {
    vi.mocked(api.refresh).mockResolvedValue({
      accessToken: makeJwt(VALID_CLAIMS),
      refreshToken: 'r2',
      expiresIn: 900,
    });
    const res = await GET(refreshRequest(), ctx);
    expect(res.headers.get('location')).toBe('/overview');
  });

  it('falls through to /login when the reissued token still fails to decode', async () => {
    vi.mocked(api.refresh).mockResolvedValue({
      accessToken: makeJwt({ sub: 'not-a-uuid', role: 'ADMIN', teamId: 'x' }),
      refreshToken: 'r2',
      expiresIn: 900,
    });
    const res = await GET(refreshRequest(), ctx);
    expect(res.headers.get('location')).toBe('/login');
  });
});

const startCtx = { params: Promise.resolve({ auth: ['sso', 'start'] }) };
const callbackCtx = { params: Promise.resolve({ auth: ['sso', 'callback'] }) };

describe('GET /api/auth/sso/start', () => {
  it('redirects to the IdP and stores the handshake secrets in the tt_oidc cookie', async () => {
    vi.mocked(api.oidcAuthorize).mockResolvedValue({
      authorizationUrl: 'https://idp.example.com/authorize?state=st',
      state: 'st',
      nonce: 'no',
      codeVerifier: 've',
    });
    const req = new NextRequest('http://localhost:3000/api/auth/sso/start');
    const res = await GET(req, startCtx);
    expect(res.headers.get('location')).toBe('https://idp.example.com/authorize?state=st');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${OIDC_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('bounces to /login?error=sso when SSO is disabled (API returns null)', async () => {
    vi.mocked(api.oidcAuthorize).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/auth/sso/start');
    const res = await GET(req, startCtx);
    expect(res.headers.get('location')).toBe('/login?error=sso');
  });
});

describe('GET /api/auth/sso/callback', () => {
  function callbackRequest(query: string, cookieState = 'st'): NextRequest {
    const cookie = encryptOidcState({ state: cookieState, nonce: 'no', codeVerifier: 've' });
    return new NextRequest(`http://localhost:3000/api/auth/sso/callback${query}`, {
      headers: { cookie: `${OIDC_COOKIE}=${cookie}` },
    });
  }

  it('exchanges the code, sets the session, clears tt_oidc, and redirects to /overview', async () => {
    vi.mocked(api.oidcCallback).mockResolvedValue({
      accessToken: makeJwt(VALID_CLAIMS),
      refreshToken: 'r',
      expiresIn: 900,
    });
    const res = await GET(callbackRequest('?code=abc&state=st'), callbackCtx);
    expect(res.headers.get('location')).toBe('/overview');
    expect(api.oidcCallback).toHaveBeenCalledWith({
      code: 'abc',
      state: 'st',
      nonce: 'no',
      codeVerifier: 've',
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    // Session established…
    const sessionMatch = /tt_session=([^;]+)/.exec(setCookie);
    const sessionValue = sessionMatch?.[1];
    expect(sessionValue).toBeTruthy();
    expect(decryptSession(decodeURIComponent(sessionValue ?? ''))).not.toBeNull();
    // …and the transient handshake cookie cleared.
    expect(setCookie).toContain(`${OIDC_COOKIE}=;`);
  });

  it('rejects a state mismatch (CSRF) without calling the API', async () => {
    const res = await GET(callbackRequest('?code=abc&state=EVIL', 'st'), callbackCtx);
    expect(res.headers.get('location')).toBe('/login?error=sso');
    expect(api.oidcCallback).not.toHaveBeenCalled();
  });

  it('bounces to /login?error=sso when the API rejects the callback', async () => {
    vi.mocked(api.oidcCallback).mockResolvedValue(null);
    const res = await GET(callbackRequest('?code=abc&state=st'), callbackCtx);
    expect(res.headers.get('location')).toBe('/login?error=sso');
  });
});
