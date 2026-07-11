/**
 * PRD §7.6 — session resolution happens server-side. Server Components call getSession()
 * to obtain the access token for API calls; the browser never holds a long-lived token.
 */
export interface Session {
  userId: string;
  role: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  accessToken: string;
}

export function getSession(): Promise<Session | null> {
  // TODO(scaffold): read + verify the httpOnly session cookie (set by app/api/auth),
  // returning the short-lived access token for server-side fetches to the NestJS API.
  return Promise.resolve(null);
}
