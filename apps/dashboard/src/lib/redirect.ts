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
