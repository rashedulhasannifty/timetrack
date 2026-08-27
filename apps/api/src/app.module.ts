import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { pinoConfig } from '@timetrack/logger';
import { loadEnv } from '@timetrack/config';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { JwtAuthGuard } from './common/guards/jwt.guard.js';
import {
  IP_THROTTLER,
  IpThrottlerGuard,
  USER_THROTTLER,
  UserThrottlerGuard,
} from './common/guards/throttler.guards.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { ResourceGuard } from './common/guards/resource.guard.js';
import { AuthzModule } from './common/authz/authz.module.js';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { PolicyModule } from './modules/policy/policy.module.js';
import { TimeEntriesModule } from './modules/time-entries/time-entries.module.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { IdleEventsModule } from './modules/idle-events/idle-events.module.js';
import { ScreenshotsModule } from './modules/screenshots/screenshots.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { HealthModule } from './modules/health/health.module.js';

const env = loadEnv();

/**
 * Rate limiting is TWO buckets, because one number cannot do both jobs.
 *
 * The API is deployed for offices behind a single NAT'd address, so a per-IP limit is in practice
 * a per-COMPANY limit. A tracking client costs roughly 4 req/min — two `GET policy/effective` per
 * activity tick, a heartbeat, and sync — so the old flat 100 req/min bound an entire office at
 * about 25 people tracking simultaneously, and shipping a second client platform brought that
 * nearer rather than further. Raising the ceiling on its own would let one misbehaving client eat
 * everybody else's budget, so the ceiling goes up AND a per-user limit goes in beneath it.
 *
 * Global provider order matters, and the two throttlers sit at different points in it:
 *
 * 1. `IpThrottlerGuard` — outermost, so an unauthenticated flood is stopped before it reaches the
 *    Argon2id verification in `POST auth/login`, which is `@Public()` and deliberately expensive.
 * 2. `JwtAuthGuard` — deny-by-default; every route except `@Public()`.
 * 3. `UserThrottlerGuard` — after authentication, because it keys on the VERIFIED user. Reading
 *    `sub` out of the bearer token before verifying it would let an attacker mint unlimited
 *    buckets by forging the claim.
 * 4. `RolesGuard`, then `ResourceGuard` for per-resource authorization.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoConfig(env) }),
    ThrottlerModule.forRoot([
      { name: IP_THROTTLER, ttl: 60_000, limit: 600 },
      { name: USER_THROTTLER, ttl: 60_000, limit: 120 },
    ]),
    PrismaModule,
    QueueModule,
    StorageModule,
    AuthzModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    ProjectsModule,
    PolicyModule,
    TimeEntriesModule,
    ActivityModule,
    IdleEventsModule,
    ScreenshotsModule,
    ReportsModule,
    ApprovalsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ResourceGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
  ],
})
export class AppModule {}
