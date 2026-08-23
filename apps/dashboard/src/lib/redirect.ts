import { NextResponse } from 'next/server';

/**
 * A 303 See Other carrying a RELATIVE Location.
 *
 * `NextResponse.redirect()` requires an ABSOLUTE url, which forces every caller to derive an
 * origin — in practice `new URL(path, req.url)`. Behind the production reverse proxy that
 * origin is the container's own `https://localhost:3000`, not the public domain, so those
 * redirects sent browsers to localhost and the site was unreachable while every service was
 * healthy.
 *
 * RFC 9110 §10.2.2 permits a relative Location and every browser resolves it against the
 * request URL. That keeps the public origin out of this layer entirely — no dependency on
 * X-Forwarded-* headers, no configured base URL to drift, and identical behaviour in dev.
 *
 * The returned response still supports `.cookies.set(...)`, which the auth routes rely on.
 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/**
 * Sanitise a caller-supplied post-refresh destination.
 *
 * `/api/auth/refresh?next=…` carries where the user was when their access token expired, so
 * they land back there instead of being dumped on /overview every fifteen minutes. That value
 * reaches us from the URL, so it is untrusted: anything that is not a single-slash absolute
 * PATH is rejected and the caller falls back to its default.
 *
 * Rejects, specifically: an absolute URL (`https://evil.test`), a protocol-relative one
 * (`//evil.test`, which a browser resolves as cross-origin), a backslash variant that some
 * browsers normalise to `//`, and anything not starting with `/`. Returns null for those.
 */
export function safeInternalPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  // Never bounce back into the auth routes themselves — that is how a redirect loop starts.
  if (next.startsWith('/api/')) return null;
  return next;
}

/**
 * The refresh URL that returns the user to `path` once a new access token is issued.
 *
 * A page whose session has expired sends the browser here rather than rendering nothing.
 * Without the `next`, an admin editing settings would be dumped on /overview every time the
 * fifteen-minute token lapsed.
 */
export function refreshBackTo(path: string): string {
  return `/api/auth/refresh?next=${encodeURIComponent(path)}`;
}
