import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QueueService } from '../../infra/queue/queue.module.js';
import { MinioService } from '../../infra/storage/minio.service.js';

/** Per-dependency readiness state, reported so an operator sees WHICH dependency failed. */
type CheckState = 'up' | 'down';

export interface Readiness {
  status: 'ok';
  checks: { database: CheckState; redis: CheckState; storage: CheckState };
}

/**
 * A probe must never hang. Without a bound, a black-holed dependency (dropped packets rather
 * than a refused connection) leaves the request open until the caller gives up, and the
 * orchestrator cannot tell "slow" from "down".
 */
const CHECK_TIMEOUT_MS = 2000;

function withTimeout(work: Promise<unknown>, label: string): Promise<unknown> {
  return Promise.race([
    work,
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`${label} check timed out after ${CHECK_TIMEOUT_MS}ms`)),
        CHECK_TIMEOUT_MS,
      ).unref(),
    ),
  ]);
}

/**
 * PRD §8 — `/health` is liveness (is the process up), `/health/ready` is readiness
 * (are its dependencies reachable). Both are @Public — a health probe carries no session.
 * VERSION_NEUTRAL: probes stay at `/health`, not `/v1/health`, so load balancers and
 * orchestrators don't need to track the API version.
 *
 * The CONTAINER healthcheck uses /health, never this route: a transient dependency blip
 * must not make Docker kill an otherwise-healthy process. This route is for the proxy and
 * the orchestrator, which pull an unready instance from rotation instead.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly storage: MinioService,
  ) {}

  @Get()
  @Public()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  async readiness(): Promise<Readiness> {
    // Checked concurrently: three serial round-trips would make the probe's latency the sum
    // of its dependencies', and a slow one would mask the others.
    const [database, redis, storage] = await Promise.all([
      this.probe(() => this.prisma.$queryRaw`SELECT 1`, 'database'),
      this.probe(() => this.queue.ping(), 'redis'),
      this.probe(() => this.storage.ping(), 'storage'),
    ]);

    const checks = { database, redis, storage };
    const down = Object.entries(checks)
      .filter(([, state]) => state === 'down')
      .map(([name]) => name);

    if (down.length > 0) {
      // 503 with the failing names in the body — enough for an operator to act on, with no
      // driver text or connection string, which would leak topology (CLAUDE.md §4).
      throw new ServiceUnavailableException({
        type: 'https://timetrack.internal/errors/not-ready',
        title: `Dependencies unreachable: ${down.join(', ')}`,
        status: 503,
        checks,
      });
    }
    return { status: 'ok', checks };
  }

  private async probe(work: () => Promise<unknown>, label: string): Promise<CheckState> {
    try {
      await withTimeout(work(), label);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
