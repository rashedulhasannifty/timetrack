import { FastifyAdapter } from '@nestjs/platform-fastify';

/**
 * The only proxy whose X-Forwarded-For the API believes: one on this host.
 *
 * Production runs the API under PM2 behind Caddy on the same box (`reverse_proxy 127.0.0.1:3001`,
 * infra/caddy/timetrack.caddy), so every request's socket peer is 127.0.0.1. Without this,
 * `req.ip` was that address for every caller and the per-IP throttler bucket was one GLOBAL
 * bucket: any anonymous flood of `POST auth/login` 429'd every tracking client in the company.
 *
 * Trusting loopback only — not `true`, not a hop count — is what keeps the header unspoofable:
 * Fastify walks X-Forwarded-For from the right and stops at the first untrusted address, so
 *  - a request whose socket peer is NOT loopback keeps that peer as `req.ip`, whatever header it
 *    sends (the API port is firewalled, but this holds even if it weren't), and
 *  - through Caddy, only the right-most entry — the one Caddy wrote — is used. Caddy (2.5+) also
 *    discards a client-sent X-Forwarded-For unless `trusted_proxies` is configured, which it isn't.
 *
 * Hardcoded rather than an env var on purpose: the only supported topology is proxy-on-the-same-
 * host (docs/deployment.md), and a configurable trust list is a way to make the limit spoofable by
 * misconfiguration. A deployment with the proxy on another host is a code change, made together
 * with whatever makes that host trustworthy.
 *
 * The dashboard BFF also calls the API over 127.0.0.1. Its sign-in calls pass on the
 * X-Forwarded-For Caddy gave it, so they are keyed on the real client too. Its other calls carry
 * none and still share the loopback address under the generic per-route ceiling, as before; they
 * are authenticated, so the per-user bucket is what bounds any one person there.
 */
const TRUSTED_PROXY = 'loopback';

/**
 * The HTTP adapter the API boots with. A function rather than inline in `main.ts` so the
 * request-IP behaviour above is exercised by tests against the exact options production uses.
 */
export function createHttpAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: 10 * 1024 * 1024, trustProxy: TRUSTED_PROXY });
}
