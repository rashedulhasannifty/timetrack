import { cookies } from 'next/headers';
import { JwtClaimsSchema } from '@timetrack/contracts';
import { SESSION_COOKIE, decryptSession } from './session-cookie';

/**
 * PRD §7.6 — session resolution happens server-side. Server Components call getSession()
 * to obtain the access token for API calls; the browser never holds a long-lived token.
 */
export interface Session {
  userId: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  accessToken: string;
}

/**
 * Decode (not verify) the access-token JWT payload. The API verifies the signature on
 * every request; the cookie is httpOnly + encrypted, so its contents are not
 * attacker-controlled. We only need the claims to shape the UI.
 */
export function decodeClaims(accessToken: string): { sub: string; role: Session['role'] } | null {
  const segment = accessToken.split('.')[1];
  if (!segment) return null;
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed = JwtClaimsSchema.safeParse(JSON.parse(json));
    return parsed.success ? { sub: parsed.data.sub, role: parsed.data.role } : null;
  } catch {
    return null;
  }
}

/**
 * Returns the current session, or null for ANY unusable state — missing cookie, decrypt
 * failure, expired access token, or invalid claims. getSession() is a pure reader: it
 * cannot write cookies, so it never refreshes. The (app) layout maps a null onto
 * /api/auth/refresh, which is the single place that reissues or falls through to /login.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const payload = decryptSession(store.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  if (payload.accessExpiresAt <= Date.now()) return null;
  const claims = decodeClaims(payload.accessToken);
  if (!claims) return null;
  return { userId: claims.sub, role: claims.role, accessToken: payload.accessToken };
}
