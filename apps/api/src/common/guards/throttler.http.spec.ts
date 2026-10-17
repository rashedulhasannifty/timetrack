import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { createHttpAdapter } from '../../http-adapter.js';
import { AuthController } from '../../modules/auth/auth.controller.js';
import { AuthService } from '../../modules/auth/auth.service.js';
import { IP_THROTTLER, IpThrottlerGuard, USER_THROTTLER } from './throttler.guards.js';

/**
 * The per-IP bucket, end to end through Fastify: what `req.ip` resolves to decides whose budget
 * a request is charged to. Unit tests of the guard can't see that — it is the adapter's
 * `trustProxy` setting, not the guard, that turns Caddy's X-Forwarded-For into `req.ip`.
 *
 * In production every request reaches the API from Caddy on 127.0.0.1, so these inject from that
 * socket address with the forwarded header Caddy would set.
 */

const CADDY = '127.0.0.1';

const tokens = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
const authStub = {
  login: () => Promise.resolve(tokens),
  refresh: () => Promise.resolve(tokens),
  acceptInvite: () => Promise.resolve(tokens),
  oidcCallback: () => Promise.resolve(tokens),
};

let app: NestFastifyApplication | undefined;

/** Production's per-IP ceiling (app.module.ts). */
const IP_LIMIT = 600;

/**
 * `ipLimit` defaults to production's. Tests about WHOSE bucket a request lands in shrink it, so
 * that exhausting one doesn't take hundreds of requests; the bucket keying is the same either way.
 */
async function server(ipLimit = IP_LIMIT): Promise<FastifyInstance> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot([
        { name: IP_THROTTLER, ttl: 60_000, limit: ipLimit },
        { name: USER_THROTTLER, ttl: 60_000, limit: 120 },
      ]),
    ],
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: authStub },
      { provide: APP_GUARD, useClass: IpThrottlerGuard },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(), {
    logger: false,
  });
  await app.init();

  // vitest transforms with esbuild, which emits no `design:paramtypes`, so Nest cannot see the
  // controller's constructor type and leaves the service unset. Wire the stub in by hand.
  Reflect.set(app.get(AuthController), 'service', authStub);

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return fastify;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A valid body for each public auth route, so only the throttler can turn a request away. */
const bodies = {
  login: { email: 'ada@example.com', password: 'password12' },
  refresh: { refreshToken: 'r' },
  'accept-invite': { token: 't', password: 'password12', name: 'Ada' },
  'oidc/callback': { code: 'c', state: 's', nonce: 'n', codeVerifier: 'v' },
} as const;

type AuthRoute = keyof typeof bodies;

function post(
  fastify: FastifyInstance,
  route: AuthRoute,
  from: string,
  forwardedFor?: string,
): Promise<LightMyRequestResponse> {
  const opts: InjectOptions = {
    method: 'POST',
    url: `/auth/${route}`,
    remoteAddress: from,
    payload: bodies[route],
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  };
  return fastify.inject(opts);
}

function refresh(
  fastify: FastifyInstance,
  from: string,
  forwardedFor?: string,
): Promise<LightMyRequestResponse> {
  return post(fastify, 'refresh', from, forwardedFor);
}

/** Fire `n` requests from one source and return the status codes. */
async function burst(n: number, send: () => Promise<LightMyRequestResponse>): Promise<number[]> {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    codes.push((await send()).statusCode);
  }
  return codes;
}

describe('per-IP rate limit behind the loopback proxy', () => {
  const LIMIT = 5;

  it('charges each forwarded client to its own bucket, not one shared loopback bucket', async () => {
    const fastify = await server(LIMIT);

    // Use up one office's whole per-IP budget on this route...
    const office = await burst(LIMIT, () => refresh(fastify, CADDY, '198.51.100.7'));
    expect(office.every((c) => c === 200)).toBe(true);
    expect((await refresh(fastify, CADDY, '198.51.100.7')).statusCode).toBe(429);

    // ...and a different client arriving through the same proxy is unaffected. Without
    // trustProxy both are `127.0.0.1`, so this was a 429 for everyone.
    expect((await refresh(fastify, CADDY, '203.0.113.20')).statusCode).toBe(200);
  });

  it('ignores X-Forwarded-For from a peer that is not the loopback proxy', async () => {
    const fastify = await server(LIMIT);
    const attacker = '192.0.2.66';

    // Rotating a self-written header per request must not mint a fresh bucket each time: the
    // header is only believed when the socket peer is the trusted proxy.
    let i = 0;
    const codes = await burst(LIMIT + 1, () => refresh(fastify, attacker, `10.0.0.${++i}`));
    expect(codes.slice(0, LIMIT).every((c) => c === 200)).toBe(true);
    expect(codes[LIMIT]).toBe(429);
  });

  it('takes the address Caddy appended, not one the client prepended', async () => {
    const fastify = await server(LIMIT);

    // A client can send its own X-Forwarded-For through the proxy; a proxy that appends would
    // forward "spoofed, real". Only the right-most, proxy-written hop may be trusted.
    await burst(LIMIT, () => refresh(fastify, CADDY, '198.51.100.7'));
    const spoofed = await refresh(fastify, CADDY, '203.0.113.99, 198.51.100.7');
    expect(spoofed.statusCode).toBe(429);
  });
});

/**
 * The credential routes get a far tighter per-IP limit than the generic 600/min: each one checks
 * a guessable secret (a password, an invite token, an IdP code), and login runs Argon2id.
 */
describe('per-IP limit on the public credential routes', () => {
  const CREDENTIAL_LIMIT = 20;
  const office = '198.51.100.7';

  it.each(['login', 'accept-invite', 'oidc/callback'] as const)(
    'turns away a %s over the limit from one address, and only that address',
    async (route) => {
      const fastify = await server();

      const codes = await burst(CREDENTIAL_LIMIT, () => post(fastify, route, CADDY, office));
      expect(codes.every((c) => c === 200)).toBe(true);

      const over = await post(fastify, route, CADDY, office);
      expect(over.statusCode).toBe(429);
      expect(over.headers['retry-after-ip']).toBeDefined();

      // Someone at another address, through the same proxy, still gets in.
      expect((await post(fastify, route, CADDY, '203.0.113.20')).statusCode).toBe(200);
    },
  );

  it('leaves token refresh on the generic limit — every tracking client in an office calls it', async () => {
    const fastify = await server();

    const codes = await burst(CREDENTIAL_LIMIT * 3, () => refresh(fastify, CADDY, office));
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('does not let failed logins spend the refresh budget of the same office', async () => {
    const fastify = await server();

    await burst(CREDENTIAL_LIMIT + 5, () => post(fastify, 'login', CADDY, office));
    expect((await refresh(fastify, CADDY, office)).statusCode).toBe(200);
  });
});
