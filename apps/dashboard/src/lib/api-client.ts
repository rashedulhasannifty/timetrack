import {
  ActivitySampleSchema,
  type ActivitySample,
  ActivityDailySummarySchema,
  type ActivityDailySummary,
  IdleEventSchema,
  type IdleEvent,
  ScreenshotSchema,
  type Screenshot,
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
  TeamSummarySchema,
  type TeamSummary,
  InviteResultSchema,
  type InviteResult,
  type InviteUser,
  TeamSettingsSchema,
  type TeamSettings,
  type UpdateSettings,
  type RedactScreenshot,
  ProjectSummarySchema,
  type ProjectSummary,
  TimesheetApprovalSchema,
  type TimesheetApproval,
  type Decision,
  AuditLogPageSchema,
  type AuditLogPage,
  type EraseUser,
  OidcAuthorizeResultSchema,
  type OidcAuthorizeResult,
  type OidcCallback,
  type Role,
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
 * Authenticated mutating request whose success response has no body (204 No Content) —
 * e.g. the erase route. Same auth header and ApiError handling as `send`, but never calls
 * `res.json()` on a 2xx, so it doesn't throw parsing an empty body. Do not change `send`
 * itself; existing callers depend on it parsing a JSON body on success.
 */
async function sendNoContent(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  token: string,
): Promise<void> {
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
}

/**
 * Streaming download: returns the RAW upstream Response (body left as a stream, not
 * parsed). Used by the /reports/export Route Handler to pipe the CSV straight to the
 * browser without buffering. The bearer token stays server-side (CLAUDE.md §4).
 */
async function getRaw(path: string, token: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
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
  listActivitySamples: (token: string, params: URLSearchParams): Promise<ActivitySample[]> =>
    get(`/activity-samples?${params}`, z.array(ActivitySampleSchema), token),
  listActivitySummaries: (
    token: string,
    params: URLSearchParams,
  ): Promise<ActivityDailySummary[]> =>
    get(`/activity-summaries?${params}`, z.array(ActivityDailySummarySchema), token),
  listIdleEvents: (token: string, params: URLSearchParams): Promise<IdleEvent[]> =>
    get(`/idle-events?${params}`, z.array(IdleEventSchema), token),
  listScreenshots: (token: string, params: URLSearchParams): Promise<Screenshot[]> =>
    get(`/screenshots?${params}`, z.array(ScreenshotSchema), token),
  redactScreenshot: (token: string, id: string, dto: RedactScreenshot): Promise<Screenshot> =>
    send('POST', `/screenshots/${id}/redact`, dto, ScreenshotSchema, token),
  listProjects: (token: string): Promise<Project[]> =>
    get('/projects', z.array(ProjectSchema), token),
  listUsers: (token: string): Promise<User[]> => get('/users', z.array(UserSchema), token),
  getCurrentTeam: (token: string): Promise<Team> => get('/teams/current', TeamSchema, token),
  teamOverview: (token: string, date?: string): Promise<TeamOverview> =>
    get(`/reports/overview${date ? `?date=${date}` : ''}`, TeamOverviewSchema, token),
  teamSummary: (token: string, params: URLSearchParams): Promise<TeamSummary> =>
    get(`/reports/team-summary?${params}`, TeamSummarySchema, token),
  projectSummary: (token: string, params: URLSearchParams): Promise<ProjectSummary> =>
    get(`/reports/projects?${params}`, ProjectSummarySchema, token),
  exportReportCsv: (token: string, params: URLSearchParams): Promise<Response> =>
    getRaw(`/reports/export.csv?${params}`, token),

  // Admin mutations (ADMIN-gated at the API; called only from server-side Server Actions).
  inviteUser: (token: string, dto: InviteUser): Promise<InviteResult> =>
    send('POST', '/users/invite', dto, InviteResultSchema, token),
  setUserActive: (token: string, id: string, deactivated: boolean): Promise<User> =>
    send('PATCH', `/users/${id}`, { deactivated }, UserSchema, token),
  setUserRole: (token: string, id: string, role: Role): Promise<User> =>
    send('PATCH', `/users/${id}`, { role }, UserSchema, token),
  updateTeamSettings: (token: string, patch: UpdateSettings): Promise<TeamSettings> =>
    send('PATCH', '/admin/settings', patch, TeamSettingsSchema, token),
  listAudit: (token: string, params: URLSearchParams): Promise<AuditLogPage> =>
    get(`/admin/audit-log?${params}`, AuditLogPageSchema, token),
  eraseUser: (token: string, id: string, dto: EraseUser): Promise<void> =>
    sendNoContent('POST', `/admin/users/${id}/erase`, dto, token),
  exportUserData: (token: string, id: string): Promise<Response> =>
    getRaw(`/admin/users/${id}/export`, token),

  // Approvals (list: EMPLOYEE self-only / MANAGER own team / ADMIN any; decide: MANAGER/ADMIN + resource authz).
  listApprovals: (token: string, params: URLSearchParams): Promise<TimesheetApproval[]> =>
    get(`/approvals?${params}`, z.array(TimesheetApprovalSchema), token),
  decideApproval: (token: string, id: string, body: Decision): Promise<TimesheetApproval> =>
    send('POST', `/approvals/${id}/decide`, body, TimesheetApprovalSchema, token),

  login: (email: string, password: string): Promise<TokenPair | null> =>
    authPost('/auth/login', { email, password }, TokenPairSchema),
  refresh: (refreshToken: string): Promise<TokenPair | null> =>
    authPost('/auth/refresh', { refreshToken }, TokenPairSchema),

  // SSO (OIDC). start() mints the flow (secrets stored in the tt_oidc cookie by the BFF);
  // callback() exchanges the IdP code for a TokenPair. Both return null on any API failure
  // (incl. 404 when SSO is disabled) so the BFF route can bounce to /login?error=sso.
  oidcAuthorize: (): Promise<OidcAuthorizeResult | null> =>
    authPost('/auth/oidc/authorize', {}, OidcAuthorizeResultSchema),
  oidcCallback: (body: OidcCallback): Promise<TokenPair | null> =>
    authPost('/auth/oidc/callback', body, TokenPairSchema),
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
