import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { loadEnv } from '@timetrack/config';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { autoApprovePendingTimesheets } from './timesheet-auto-approve.js';

/**
 * PRD §6.5 — approves PENDING timesheets a manager has left past the team's grace period,
 * for teams that switched `autoApproveTimesheets` on. An optional { at } ISO string overrides
 * "now" (backfill / tests); otherwise the job's run time is used.
 */
@Injectable()
@Processor('timesheet-auto-approve')
export class TimesheetAutoApproveProcessor extends WorkerHost {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ at?: string }>): Promise<void> {
    const now = job.data?.at ? new Date(job.data.at) : new Date();
    const outcome = await autoApprovePendingTimesheets(
      this.prisma,
      now,
      this.env.TRACKING_FRESHNESS_SECONDS,
    );
    // The skip counts are the point of the log line: a team that switched auto-approve on and
    // sees nothing approved needs to know which guardrail is holding, not just that none were.
    this.logger.log({ ...outcome }, 'timesheet-auto-approve run complete');
  }
}
