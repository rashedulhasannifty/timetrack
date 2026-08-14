import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';

/**
 * PRD §6.7 — registers the two weekly emails as repeatable jobs on the `email` queue.
 * Idempotent (upsertJobScheduler) so every worker boot/replica converges to one, matching
 * RollupScheduler's shape.
 *
 * Both run on Monday, AFTER `timesheet-generate` (00:30 Mon) has created that week's PENDING
 * rows — the summary counts those rows, so running first would report zero every week. They are
 * an hour apart so a manager's summary lands before their team starts replying to reminders.
 */
@Injectable()
export class EmailScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue('email') private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'weekly-summary-cron',
      { pattern: '0 8 * * 1', tz: 'UTC' },
      { name: 'weekly-summary', data: {} },
    );
    await this.queue.upsertJobScheduler(
      'missing-timesheet-cron',
      { pattern: '0 9 * * 1', tz: 'UTC' },
      { name: 'missing-timesheet', data: {} },
    );
    this.logger.log('weekly email schedulers registered (08:00 / 09:00 Mon UTC)');
  }
}
