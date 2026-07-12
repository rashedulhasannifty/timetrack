import { NextResponse, type NextRequest } from 'next/server';
import { api } from '../../../../lib/api-client';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  decryptSession,
  encryptSession,
  sessionCookieAttributes,
  type SessionPayload,
} from '../../../../lib/session-cookie';

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

function redirect(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.url), 303);
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
    const res = redirect(req, '/');
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

  if (action === 'refresh') {
    const current = decryptSession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!current) {
      const res = redirect(req, '/login');
      clearSession(res);
      return res;
    }
    const tokens = await api.refresh(current.refreshToken);
    if (!tokens) {
      const res = redirect(req, '/login');
      clearSession(res);
      return res;
    }
    const res = redirect(req, '/');
    setSession(res, payloadFrom(tokens));
    return res;
  }

  return new NextResponse('Not found', { status: 404 });
}
