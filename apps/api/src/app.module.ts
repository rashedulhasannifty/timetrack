import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { pinoConfig } from '@timetrack/logger';
import { loadEnv } from '@timetrack/config';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { JwtAuthGuard } from './common/guards/jwt.guard.js';
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
import { ScreenshotsModule } from './modules/screenshots/screenshots.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { HealthModule } from './modules/health/health.module.js';

const env = loadEnv();

/**
 * Global provider order matters: the throttler runs first, then JWT authentication
 * (deny-by-default — every route except @Public()), then role gating. Resource-level
 * checks (owning the team, reading only yourself) live in the services, not here.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoConfig(env) }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthzModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    ProjectsModule,
    PolicyModule,
    TimeEntriesModule,
    ActivityModule,
    ScreenshotsModule,
    ReportsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ResourceGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
  ],
})
export class AppModule {}
