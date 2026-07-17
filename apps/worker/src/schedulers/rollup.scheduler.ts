import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';

/**
 * PRD §6.3 — registers the daily activity rollup as a repeatable BullMQ job (00:15 UTC),
 * so the rollup-daily processor runs shortly after midnight for the previous UTC day.
 * upsertJobScheduler is idempotent, so every worker boot (and every replica) converges
 * to a single scheduler. First repeatable job in the codebase — keep the shape reusable.
 */
@Injectable()
export class RollupScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue('rollup-daily') private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'rollup-daily-cron',
      { pattern: '15 0 * * *', tz: 'UTC' },
      { name: 'rollup', data: {} },
    );
    this.logger.log('rollup-daily scheduler registered (15 0 * * * UTC)');
  }
}
