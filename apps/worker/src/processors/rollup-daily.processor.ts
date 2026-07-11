import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { WorkerPrisma } from '../infra/prisma.provider.js';

/**
 * PRD §6.3 — activity samples are rolled up into per-day / per-week summaries here,
 * off the request path. Feeds the dashboard's activity-% views and reports.
 */
@Injectable()
@Processor('rollup-daily')
export class RollupDailyProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  process(): Promise<void> {
    // TODO(scaffold): aggregate the previous day's activity_samples per user (avg
    // activityPct, minutes per app/category) into a summary table.
    void this.prisma;
    this.logger.log('rollup-daily started');
    return Promise.resolve();
  }
}
