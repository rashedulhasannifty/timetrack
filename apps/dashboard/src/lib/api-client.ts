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
