import { NextResponse, type NextRequest } from 'next/server';
import { api } from '../../../../../../lib/api-client';
import { getSession } from '../../../../../../lib/session';
import { seeOther } from '../../../../../../lib/redirect';

/**
 * PRD §4.4 — a user's data export downloads through this Route Handler, never the API directly,
 * so the access token stays server-side. ADMIN-gated here and again at the API.
 */
export const runtime = 'nodejs'; // session-cookie decryption uses node:crypto.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return seeOther('/api/auth/refresh');
  if (session.role !== 'ADMIN') return new NextResponse('Forbidden', { status: 403 });

  const { userId } = await params;
  const upstream = await api.exportUserData(session.accessToken, userId);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(`Export failed (${upstream.status})`, { status: upstream.status });
  }
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'content-disposition':
        upstream.headers.get('content-disposition') ??
        `attachment; filename="timetrack-user-${userId}-export.json"`,
      'cache-control': 'no-store',
    },
  });
}
