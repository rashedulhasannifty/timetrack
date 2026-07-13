import {
  TimeEntrySchema,
  type TimeEntry,
  ProjectSchema,
  type Project,
  UserSchema,
  type User,
  TeamSchema,
  type Team,
  TokenPairSchema,
  type TokenPair,
  TeamOverviewSchema,
  type TeamOverview,
  InviteResultSchema,
  type InviteResult,
  type InviteUser,
  TeamSettingsSchema,
  type TeamSettings,
  type UpdateSettings,
} from '@timetrack/contracts';
import { z } from 'zod';

/**
 * CLAUDE.md §4 — the ONLY file that knows the API base URL.
 * Types come from @timetrack/contracts. Never hand-write a response interface.
 * Responses are parsed, not cast: an API that drifts fails loudly here.
 */
// The API serves all routes under /v1 (see apps/api main.ts). Health probes are
// version-neutral, but data endpoints are versioned.
const API_URL = `${process.env.API_URL ?? 'http://localhost:3001'}/v1`;

async function get<T>(path: string, schema: z.ZodType<T>, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`api ${res.status} on ${path}`);
  return schema.parse(await res.json());
}

/**
 * An API error that carries the HTTP status and the human `title` from the RFC 9457
 * problem+json body. Server Actions catch this to show the user a specific message
 * (e.g. "Cannot deactivate the last active admin") instead of a generic failure.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Authenticated mutating request (POST/PATCH). Used only from server-side Server Actions —
 * the browser never holds the bearer token. On a non-2xx it throws an ApiError carrying the
 * problem+json `title` so the action can surface a precise, non-leaky message.
 */
async function send<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  token: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const problem = (await res.json().catch(() => null)) as { title?: unknown } | null;
    const title =
      problem && typeof problem.title === 'string'
        ? problem.title
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, title);
  }
  return schema.parse(await res.json());
}

/**
 * Unauthenticated POST used by the auth Route Handler. Returns null on any non-2xx so the
 * handler can redirect (e.g. bad credentials → /login?error=1) without surfacing the API
 * error body to the browser.
 */
async function authPost<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return schema.parse(await res.json());
}

export const api = {
  listTimeEntries: (token: string, params: URLSearchParams): Promise<TimeEntry[]> =>
    get(`/time-entries?${params}`, z.array(TimeEntrySchema), token),
  listProjects: (token: string): Promise<Project[]> =>
    get('/projects', z.array(ProjectSchema), token),
  listUsers: (token: string): Promise<User[]> => get('/users', z.array(UserSchema), token),
  getCurrentTeam: (token: string): Promise<Team> => get('/teams/current', TeamSchema, token),
  teamOverview: (token: string, date?: string): Promise<TeamOverview> =>
    get(`/reports/overview${date ? `?date=${date}` : ''}`, TeamOverviewSchema, token),

  // Admin mutations (ADMIN-gated at the API; called only from server-side Server Actions).
  inviteUser: (token: string, dto: InviteUser): Promise<InviteResult> =>
    send('POST', '/users/invite', dto, InviteResultSchema, token),
  setUserActive: (token: string, id: string, deactivated: boolean): Promise<User> =>
    send('PATCH', `/users/${id}`, { deactivated }, UserSchema, token),
  updateTeamSettings: (token: string, patch: UpdateSettings): Promise<TeamSettings> =>
    send('PATCH', '/admin/settings', patch, TeamSettingsSchema, token),

  login: (email: string, password: string): Promise<TokenPair | null> =>
    authPost('/auth/login', { email, password }, TokenPairSchema),
  refresh: (refreshToken: string): Promise<TokenPair | null> =>
    authPost('/auth/refresh', { refreshToken }, TokenPairSchema),
  logout: async (refreshToken: string): Promise<void> => {
    // Idempotent server-side; fire-and-ignore the result. Never throw on logout.
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      /* best effort */
    }
  },
};
