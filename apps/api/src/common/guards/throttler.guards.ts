import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { SessionUser } from '../decorators/current-user.decorator.js';

/** Names of the two rate-limit buckets configured in `app.module.ts`. */
export const IP_THROTTLER = 'ip';
export const USER_THROTTLER = 'user';

/**
 * A `ThrottlerGuard` that enforces exactly ONE of the configured buckets.
 *
 * `ThrottlerGuard` normally applies every definition in the module config, which would make the
 * two buckets indistinguishable in the guard chain. They must be separable, because they run at
 * different points in it: the per-IP limit has to be OUTERMOST so it protects `@Public()` login
 * before Argon2 ever runs, while the per-user limit can only run AFTER `JwtAuthGuard`, since
 * before that there is no verified user to key on.
 *
 * `generateKey` already includes the definition name, so the two buckets never share a key.
 */
@Injectable()
abstract class SingleBucketThrottlerGuard extends ThrottlerGuard {
  protected abstract readonly bucket: string;

  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name === this.bucket);
  }
}

/**
 * The outer ceiling: requests per minute from one source address, whoever they claim to be.
 *
 * Deliberately first in the chain. Every authentication route is `@Public()` and `POST auth/login`
 * verifies an Argon2id hash — intentionally expensive — so an unauthenticated flood has to be
 * stopped before it reaches that, not after.
 */
@Injectable()
export class IpThrottlerGuard extends SingleBucketThrottlerGuard {
  protected readonly bucket = IP_THROTTLER;
}

/**
 * The fairness limit: requests per minute from one authenticated user.
 *
 * This is the bucket that makes the ceiling above safe to raise. The API is deployed for offices
 * that share one NAT'd address, so a per-IP limit is really a per-COMPANY limit — a tracking
 * client costs roughly 4 req/min (two policy fetches per activity tick, a heartbeat, and sync),
 * so a flat 100 req/min bound the whole office at ~25 people tracking at once, and adding a second
 * client platform brought that closer. Raising the IP ceiling alone would mean one misbehaving
 * client could consume everyone else's budget; per-user is what stops that.
 *
 * **Keyed on the VERIFIED user**, which is the reason this guard runs after `JwtAuthGuard` rather
 * than reading `sub` out of the bearer token itself. An unverified `sub` is attacker-chosen, so it
 * would let anyone mint unlimited buckets and walk straight past both limits.
 */
@Injectable()
export class UserThrottlerGuard extends SingleBucketThrottlerGuard {
  protected readonly bucket = USER_THROTTLER;

  /**
   * Anonymous traffic is not this guard's job. A `@Public()` route reaches here with no user
   * attached, and is already covered by {@link IpThrottlerGuard}; keying those on the IP again
   * would just charge them twice for the same request.
   */
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) {
      return true;
    }

    const { req } = this.getRequestResponse(context);
    return (req as { user?: SessionUser }).user?.id === undefined;
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as { user?: SessionUser }).user;

    // shouldSkip has already established there is one; this only narrows the type.
    return Promise.resolve(user ? `user:${user.id}` : 'anonymous');
  }
}
