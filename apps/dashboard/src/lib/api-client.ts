import { TimeEntrySchema, type TimeEntry } from '@timetrack/contracts';
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

export const api = {
  listTimeEntries: (token: string, params: URLSearchParams): Promise<TimeEntry[]> =>
    get(`/time-entries?${params}`, z.array(TimeEntrySchema), token),
};
