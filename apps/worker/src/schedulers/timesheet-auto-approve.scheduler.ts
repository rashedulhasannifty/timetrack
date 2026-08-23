import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { APP_TIMEZONE } from '@timetrack/contracts';

/**
 * PRD §6.5 — registers the auto-approval sweep as a repeatable BullMQ job. DAILY, not weekly:
 * the grace period is per-team and counted from the period end, so the day a given timesheet
 * becomes eligible varies. Runs at 01:00 in APP_TIMEZONE, after the daily rollup (00:15) so a
 * week's activity data is settled before anything is approved against it.
 *
 * Idempotent (upsertJobScheduler) so every worker boot/replica converges to one.
 */
@Injectable()
export class TimesheetAutoApproveScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue('timesheet-auto-approve') private readonly queue: Queue,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'timesheet-auto-approve-cron',
      { pattern: '0 1 * * *', tz: APP_TIMEZONE },
      { name: 'timesheet-auto-approve', data: {} },
    );
    this.logger.log(`timesheet-auto-approve scheduler registered (0 1 * * * ${APP_TIMEZONE})`);
  }
}
