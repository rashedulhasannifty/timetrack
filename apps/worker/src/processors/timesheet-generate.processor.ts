import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { loadEnv } from '@timetrack/config';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { generatePendingTimesheets } from './timesheet-generate.js';

/**
 * PRD §6.5 — off the request path. Regenerates PENDING timesheet approvals for the last
 * 4 closed ISO weeks (late-sync tolerant). An optional { at } ISO string overrides "now"
 * for backfill; otherwise the job's run time is used.
 */
@Injectable()
@Processor('timesheet-generate')
export class TimesheetGenerateProcessor extends WorkerHost {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ at?: string }>): Promise<void> {
    const now = job.data?.at ? new Date(job.data.at) : new Date();
    const created = await generatePendingTimesheets(
      this.prisma,
      now,
      this.env.TRACKING_FRESHNESS_SECONDS,
    );
    this.logger.log({ created }, 'timesheet-generate run complete');
  }
}
