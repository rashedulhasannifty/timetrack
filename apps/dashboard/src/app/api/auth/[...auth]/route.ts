import { NextResponse } from 'next/server';

/**
 * PRD §7.6 — this route manages the session COOKIE only; it never proxies data. On
 * login it should call the NestJS API, then set an httpOnly session cookie. Data reads
 * go straight from Server Components to the API with the session's access token.
 */
export function POST(): NextResponse {
  // TODO(scaffold): exchange credentials with the API, set an httpOnly session cookie.
  return NextResponse.json(
    { type: 'https://timetrack.internal/errors/not-implemented', title: 'Not implemented', status: 501 },
    { status: 501 },
  );
}

export function GET(): NextResponse {
  // TODO(scaffold): return the current session's non-sensitive fields, or 401.
  return NextResponse.json({ authenticated: false }, { status: 200 });
}
