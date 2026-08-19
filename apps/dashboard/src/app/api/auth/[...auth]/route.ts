import { NextResponse, type NextRequest } from 'next/server';
import { api } from '../../../../lib/api-client';
import { decodeClaims } from '../../../../lib/session';
import { seeOther } from '../../../../lib/redirect';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  decryptSession,
  encryptSession,
  sessionCookieAttributes,
  type SessionPayload,
} from '../../../../lib/session-cookie';
import {
  OIDC_COOKIE,
  OIDC_MAX_AGE_SECONDS,
  decryptOidcState,
  encryptOidcState,
  oidcCookieAttributes,
} from '../../../../lib/oidc-cookie';

/**
 * PRD §7.6 — this route manages the session COOKIE only; it never proxies data reads.
 * It is the ONLY place cookies are written (login/logout/refresh), because Next Server
 * Components can only read cookies and the API rotates refresh tokens single-use.
 */
export const runtime = 'nodejs'; // node:crypto in session-cookie needs the Node runtime.

function payloadFrom(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}): SessionPayload {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

// Relative Location — see lib/redirect.ts. `req` is intentionally unused: deriving the
// origin from it is what sent production browsers to https://localhost:3000.
function redirect(_req: NextRequest, path: string): NextResponse {
  return seeOther(path);
}

function setSession(res: NextResponse, payload: SessionPayload): void {
  res.cookies.set(
    SESSION_COOKIE,
    encryptSession(payload),
    sessionCookieAttributes(SESSION_MAX_AGE_SECONDS),
  );
}

function clearSession(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', sessionCookieAttributes(0));
}

function clearOidc(res: NextResponse): void {
  res.cookies.set(OIDC_COOKIE, '', oidcCookieAttributes(0));
}

/** Abandon the SSO handshake: drop the transient cookie and bounce to the login error. */
function ssoFailure(req: NextRequest): NextResponse {
  const res = redirect(req, '/login?error=sso');
  clearOidc(res);
  return res;
}

async function segment(ctx: { params: Promise<{ auth: string[] }> }): Promise<string> {
  const { auth } = await ctx.params;
  return auth[auth.length - 1] ?? '';
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ auth: string[] }> },
): Promise<NextResponse> {
  const action = await segment(ctx);

  if (action === 'login') {
    const form = await req.formData();
    const emailVal = form.get('email');
    const passwordVal = form.get('password');
    if (typeof emailVal !== 'string' || typeof passwordVal !== 'string') {
      return redirect(req, '/login?error=1');
    }
    const tokens = await api.login(emailVal, passwordVal);
    if (!tokens) return redirect(req, '/login?error=1');
    const res = redirect(req, '/overview');
    setSession(res, payloadFrom(tokens));
    return res;
  }

  // An invitee has no session yet: they arrive from the emailed link with a one-time token.
  // On success the API returns a TokenPair, so this establishes the session like login does.
  if (action === 'accept-invite') {
    const form = await req.formData();
    const tokenVal = form.get('token');
    const passwordVal = form.get('password');
    const confirmVal = form.get('confirm');
    if (typeof tokenVal !== 'string' || tokenVal.length === 0) {
      return redirect(req, '/accept-invite?error=invalid');
    }
    // Keep the token on every error redirect so the invitee can retry without re-opening
    // the email. It is a URL parameter they already hold.
    const back = (code: string): NextResponse =>
      redirect(req, `/accept-invite?token=${encodeURIComponent(tokenVal)}&error=${code}`);

    if (typeof passwordVal !== 'string' || passwordVal.length < 8) return back('weak');
    if (passwordVal !== confirmVal) return back('mismatch');

    const tokens = await api.acceptInvite(tokenVal, passwordVal);
    // 401 → the token is invalid, expired, or already used. Re-showing the form would just
    // fail again, so send them to /login without the token.
    if (!tokens) return redirect(req, '/accept-invite?error=invalid');
    const res = redirect(req, '/overview');
    setSession(res, payloadFrom(tokens));
    return res;
  }

  if (action === 'logout') {
    const current = decryptSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (current) await api.logout(current.refreshToken);
    const res = redirect(req, '/login');
    clearSession(res);
    return res;
  }

  return new NextResponse('Not found', { status: 404 });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ auth: string[] }> },
): Promise<NextResponse> {
  const action = await segment(ctx);

  // SSO (OIDC) step 1: ask the API to mint the flow, stash the per-request secrets in the
  // short tt_oidc cookie, and hand the browser off to the IdP.
  if (action === 'start') {
    const authorize = await api.oidcAuthorize();
    if (!authorize) return ssoFailure(req); // SSO disabled (404) or the IdP is unavailable
    const res = NextResponse.redirect(authorize.authorizationUrl, 303);
    res.cookies.set(
      OIDC_COOKIE,
      encryptOidcState({
        state: authorize.state,
        nonce: authorize.nonce,
        codeVerifier: authorize.codeVerifier,
      }),
      oidcCookieAttributes(OIDC_MAX_AGE_SECONDS),
    );
    return res;
  }

  // SSO (OIDC) step 2: the IdP redirected back with ?code&state. Re-bind to the cookie the
  // browser is carrying, exchange server-to-server, and establish the normal session.
  if (action === 'callback') {
    const handshake = decryptOidcState(req.cookies.get(OIDC_COOKIE)?.value);
    const code = req.nextUrl.searchParams.get('code');
    const state = req.nextUrl.searchParams.get('state');
    // No cookie / no code / state mismatch → CSRF or an expired handshake. Fail closed.
    if (!handshake || !code || !state || state !== handshake.state) {
      return ssoFailure(req);
    }
    const tokens = await api.oidcCallback({
      code,
      state,
      nonce: handshake.nonce,
      codeVerifier: handshake.codeVerifier,
    });
    // Loop-breaker (mirrors refresh): a token we can't decode would bounce forever.
    if (!tokens || !decodeClaims(tokens.accessToken)) return ssoFailure(req);
    const res = redirect(req, '/overview');
    setSession(res, payloadFrom(tokens));
    clearOidc(res);
    return res;
  }

  if (action === 'refresh') {
    const current = decryptSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!current) {
      const res = redirect(req, '/login');
      clearSession(res);
      return res;
    }
    const outcome = await api.refresh(current.refreshToken);
    if (outcome.status === 'unavailable') {
      // The API is unreachable or erroring — which says NOTHING about the refresh token.
      // Keep the cookie: clearing it here logged people out over a redeploy and burned a
      // session that was still valid. 503 rather than a redirect, so this cannot become a
      // bounce loop while the API is down.
      return new NextResponse('Sign-in is temporarily unavailable. Please try again shortly.', {
        status: 503,
        headers: { 'retry-after': '10' },
      });
    }
    if (outcome.status === 'rejected') {
      const res = redirect(req, '/login');
      clearSession(res);
      return res;
    }
    const tokens = outcome.tokens;
    // Loop-breaker: if the freshly issued access token still can't be decoded, a redirect
    // back to the app would just bounce here again and burn a rotation each hop. Stop at /login.
    if (!decodeClaims(tokens.accessToken)) {
      const res = redirect(req, '/login');
      clearSession(res);
      return res;
    }
    const res = redirect(req, '/overview');
    setSession(res, payloadFrom(tokens));
    return res;
  }

  return new NextResponse('Not found', { status: 404 });
}
