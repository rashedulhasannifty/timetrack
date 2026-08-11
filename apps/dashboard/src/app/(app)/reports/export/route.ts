import { NextResponse, type NextRequest } from 'next/server';
import { api } from '../../../../lib/api-client';
import { getSession } from '../../../../lib/session';
import { seeOther } from '../../../../lib/redirect';

/**
 * PRD §6.5 / slice 3.2 — streaming CSV download. The browser hits this Route Handler
 * (not the API directly) so the access token never leaves the server. We forward the
 * report filters to GET /v1/reports/export.csv with the session bearer token and pipe
 * the upstream stream straight through, preserving its Content-Disposition/Content-Type.
 * A null session bounces to the refresh route; a non-2xx upstream status is propagated.
 */
export const runtime = 'nodejs'; // session-cookie decryption uses node:crypto.

const FILTER_KEYS = ['from', 'to', 'userId', 'projectId', 'teamId'] as const;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return seeOther('/api/auth/refresh');
  }

  const src = req.nextUrl.searchParams;
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = src.get(key);
    if (value) params.set(key, value);
  }

  const upstream = await api.exportReportCsv(session.accessToken, params);
  if (!upstream.ok || !upstream.body) {
    // The API already returned problem+json; surface only the status to the browser.
    return new NextResponse(`Export failed (${upstream.status})`, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'content-disposition':
        upstream.headers.get('content-disposition') ??
        'attachment; filename="timetrack-export.csv"',
      'cache-control': 'no-store',
    },
  });
}
