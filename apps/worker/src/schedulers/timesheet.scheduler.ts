import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';

/**
 * PRD §6.5 — registers weekly timesheet generation as a repeatable BullMQ job (Mondays
 * 00:30 UTC). Idempotent (upsertJobScheduler) so every worker boot/replica converges to one.
 */
@Injectable()
export class TimesheetScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue('timesheet-generate') private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'timesheet-generate-cron',
      { pattern: '30 0 * * 1', tz: 'UTC' },
      { name: 'timesheet-generate', data: {} },
    );
    this.logger.log('timesheet-generate scheduler registered (30 0 * * 1 UTC)');
  }
}
