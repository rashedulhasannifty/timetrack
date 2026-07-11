import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * PRD §8 — `/health` is liveness (is the process up), `/health/ready` is readiness
 * (are its dependencies reachable). Both are @Public — a health probe carries no session.
 * VERSION_NEUTRAL: probes stay at `/health`, not `/v1/health`, so load balancers and
 * orchestrators don't need to track the API version.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async readiness(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        type: 'https://timetrack.internal/errors/not-ready',
        title: 'Database unreachable',
        status: 503,
      });
    }
    // TODO(scaffold): add Redis (queue) and MinIO reachability checks here (PRD §8).
    return { status: 'ok', checks: { database: 'up' } };
  }
}
