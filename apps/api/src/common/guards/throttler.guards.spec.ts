import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import {
  IP_THROTTLER,
  IpThrottlerGuard,
  USER_THROTTLER,
  UserThrottlerGuard,
} from './throttler.guards.js';
import type { SessionUser } from '../decorators/current-user.decorator.js';

const user: SessionUser = { id: 'u1', role: 'EMPLOYEE', teamId: 't1' };

const options: ThrottlerModuleOptions = [
  { name: IP_THROTTLER, ttl: 60_000, limit: 600 },
  { name: USER_THROTTLER, ttl: 60_000, limit: 120 },
];

const storage = { increment: vi.fn() } as unknown as ThrottlerStorage;

const reflector = {
  getAllAndOverride: vi.fn().mockReturnValue(undefined),
  get: vi.fn().mockReturnValue(undefined),
} as unknown as Reflector;

function ctx(req: Record<string, unknown>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ header: vi.fn() }) }),
  } as unknown as ExecutionContext;
}

/** The members under test are `protected`; these subclasses only widen access. */
class ExposedIpGuard extends IpThrottlerGuard {
  buckets = (): string[] => this.throttlers.map((t) => t.name ?? 'default');
}

class ExposedUserGuard extends UserThrottlerGuard {
  buckets = (): string[] => this.throttlers.map((t) => t.name ?? 'default');
  skip = (c: ExecutionContext): Promise<boolean> => this.shouldSkip(c);
  track = (req: Record<string, unknown>): Promise<string> => this.getTracker(req);
}

async function ipGuard(): Promise<ExposedIpGuard> {
  const guard = new ExposedIpGuard(options, storage, reflector);
  await guard.onModuleInit();
  return guard;
}

async function userGuard(): Promise<ExposedUserGuard> {
  const guard = new ExposedUserGuard(options, storage, reflector);
  await guard.onModuleInit();
  return guard;
}

/**
 * Two buckets that must stay separable, because they run at different points in the guard chain:
 * per-IP outermost (so `@Public()` login is protected before Argon2), per-user after
 * `JwtAuthGuard` (so there is a verified user to key on). `ThrottlerGuard` applies every
 * configured definition by default, which would collapse that distinction.
 */
describe('the split rate-limit buckets', () => {
  it('each guard enforces only its own bucket', async () => {
    expect((await ipGuard()).buckets()).toEqual([IP_THROTTLER]);
    expect((await userGuard()).buckets()).toEqual([USER_THROTTLER]);
  });

  it('leaves anonymous traffic to the per-IP guard alone', async () => {
    // A @Public() route reaches the user guard with nothing attached. Keying it on the address
    // again would charge the same request against two buckets.
    await expect((await userGuard()).skip(ctx({ ip: '203.0.113.5' }))).resolves.toBe(true);
  });

  it('applies to an authenticated request', async () => {
    await expect((await userGuard()).skip(ctx({ ip: '203.0.113.5', user }))).resolves.toBe(false);
  });

  it('keys on the user, so one office address is no longer one budget', async () => {
    const guard = await userGuard();
    const shared = '203.0.113.5';

    const a = await guard.track({ ip: shared, user });
    const b = await guard.track({
      ip: shared,
      user: { ...user, id: 'u2' } satisfies SessionUser,
    });

    expect(a).not.toBe(b);
    expect(a).toContain('u1');
  });

  /**
   * The reason this guard runs AFTER `JwtAuthGuard` instead of reading the bearer token itself.
   *
   * `req.user` is written by `JwtAuthGuard` from verified claims. A `sub` lifted out of the raw
   * Authorization header is attacker-chosen, so keying on it would let anyone mint an unlimited
   * number of buckets and walk past both limits. The tracker must ignore the header entirely —
   * here it carries a different, unverified subject.
   */
  it('ignores the bearer token and keys only on the verified user', async () => {
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker-chosen' })).toString('base64url');

    const tracked = await (
      await userGuard()
    ).track({
      ip: '203.0.113.5',
      user,
      headers: { authorization: `Bearer header.${forged}.sig` },
    });

    expect(tracked).toBe('user:u1');
    expect(tracked).not.toContain('attacker-chosen');
  });
});
