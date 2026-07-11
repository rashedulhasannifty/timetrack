import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';

/**
 * PRD §6.7 — email notifications, off the request path. The two documented jobs
 * (weekly manager summary, missing-timesheet reminder) are job types on the single
 * `email` queue, dispatched here by name.
 */
@Injectable()
@Processor('email')
export class EmailProcessor extends WorkerHost {
  constructor(private readonly logger: Logger) {
    super();
  }

  process(job: Job): Promise<void> {
    switch (job.name) {
      case 'weekly-summary':
        // TODO(scaffold): render + send the weekly manager summary.
        this.logger.log({ jobId: job.id }, 'weekly-summary received');
        break;
      case 'missing-timesheet':
        // TODO(scaffold): send missing-timesheet reminders.
        this.logger.log({ jobId: job.id }, 'missing-timesheet received');
        break;
      default:
        this.logger.warn({ jobName: job.name }, 'unknown email job');
    }
    return Promise.resolve();
  }
}
