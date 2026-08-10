import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { loadEnv } from '@timetrack/config';
import { Mailer } from '../../infra/mailer.provider.js';
import { renderInviteEmail } from './invite-email.js';

/** The `invite` job payload, produced by the API's InvitesService. Internal to the queue —
 * not an HTTP DTO, so it does not belong in packages/contracts. */
interface InviteJobData {
  email: string;
  name: string;
  inviteToken: string;
  expiresAt: string;
}

function isInviteJobData(data: unknown): data is InviteJobData {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.email === 'string' &&
    typeof d.name === 'string' &&
    typeof d.inviteToken === 'string' &&
    typeof d.expiresAt === 'string'
  );
}

/**
 * PRD §6.7 — email notifications, off the request path. The documented jobs are job types
 * on the single `email` queue, dispatched here by name.
 */
@Injectable()
@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly env = loadEnv();

  constructor(
    private readonly logger: Logger,
    private readonly mailer: Mailer,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'weekly-summary':
        // TODO(scaffold): render + send the weekly manager summary.
        this.logger.log({ jobId: job.id }, 'weekly-summary received');
        break;
      case 'missing-timesheet':
        // TODO(scaffold): send missing-timesheet reminders.
        this.logger.log({ jobId: job.id }, 'missing-timesheet received');
        break;
      case 'invite':
        await this.sendInvite(job);
        break;
      default:
        this.logger.warn({ jobName: job.name }, 'unknown email job');
    }
  }

  private async sendInvite(job: Job): Promise<void> {
    if (!isInviteJobData(job.data)) {
      // Malformed payload is a producer bug, not a transient fault — retrying cannot fix
      // it. Log and swallow so the job does not burn its three attempts.
      this.logger.error({ jobId: job.id }, 'invite job has a malformed payload');
      return;
    }
    const { email, name, inviteToken, expiresAt } = job.data;
    const mail = renderInviteEmail({ name, inviteToken, expiresAt, appUrl: this.env.APP_URL });

    if (!this.mailer.enabled) {
      // SES unconfigured — development only. The URL carries the token, so it is logged
      // ONLY here, never in production, mirroring the API's dev-only `devToken`.
      if (this.env.NODE_ENV === 'development') {
        this.logger.warn(
          { jobId: job.id, email, acceptUrl: mail.acceptUrl },
          'email is not configured — invite not sent; use this accept link',
        );
      } else {
        this.logger.error({ jobId: job.id, email }, 'email is not configured — invite NOT sent');
      }
      return;
    }

    // Throws on failure so BullMQ retries (3 attempts, exponential backoff).
    await this.mailer.send({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log({ jobId: job.id, email }, 'invite email sent');
  }
}
