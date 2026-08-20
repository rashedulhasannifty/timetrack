import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { loadEnv } from '@timetrack/config';
import { Mailer, type OutboundEmail } from '../../infra/mailer.provider.js';
import { WorkerPrisma } from '../../infra/prisma.provider.js';
import { closedWeek, type ClosedWeek } from './closed-week.js';
import { renderInviteEmail } from './invite-email.js';
import { collectMissingTimesheets, renderMissingTimesheetEmail } from './missing-timesheet.js';
import { collectWeeklySummaries, renderWeeklySummaryEmail } from './weekly-summary.js';

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
 * Which week the scheduled jobs report on. Normally the week that just closed, but an optional
 * `now` in the job data overrides the clock, so an operator can re-enqueue `weekly-summary`
 * with `{ now: '2026-08-10T00:00:00Z' }` to resend an earlier week. An unparseable value falls
 * back to the real clock rather than failing the run.
 */
function reportedWeek(job: Job): ClosedWeek {
  const raw = (job.data as { now?: unknown } | null | undefined)?.now;
  const at = typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date();
  return closedWeek(at);
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
    private readonly prisma: WorkerPrisma,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'weekly-summary':
        await this.sendWeeklySummaries(job);
        break;
      case 'missing-timesheet':
        await this.sendMissingTimesheetReminders(job);
        break;
      case 'invite':
        await this.sendInvite(job);
        break;
      default:
        this.logger.warn({ jobName: job.name }, 'unknown email job');
    }
  }

  /**
   * True when mail can actually go out. Checked BEFORE any query: on an unconfigured
   * deployment the weekly jobs would otherwise scan every team each Monday to render
   * messages that get dropped.
   */
  private canSend(job: Job): boolean {
    if (this.mailer.enabled) return true;
    const detail = { jobId: job.id, jobName: job.name };
    if (this.env.NODE_ENV === 'development') {
      this.logger.warn(detail, 'email is not configured — scheduled email skipped');
    } else {
      this.logger.error(detail, 'email is not configured — scheduled email NOT sent');
    }
    return false;
  }

  /**
   * Deliver one fan-out batch. Unlike `sendInvite`, a failure here is NOT rethrown: these jobs
   * are one job → N messages, so a BullMQ retry would re-send every message that had already
   * succeeded — managers would receive the same summary three times. At-most-once per recipient
   * with the failures logged is the right trade for a weekly digest; next Monday's run is the
   * recovery path. If a stronger guarantee is ever needed, fan out to one child job per
   * recipient and let the CHILD throw. Do not make this loop throw.
   */
  private async deliver(job: Job, messages: OutboundEmail[]): Promise<void> {
    let sent = 0;
    const failed: string[] = [];
    for (const message of messages) {
      try {
        await this.mailer.send(message);
        sent++;
      } catch (e) {
        failed.push(message.to);
        this.logger.error(
          {
            jobId: job.id,
            jobName: job.name,
            to: message.to,
            // `reason`, not `err`: pino reserves `err` for its Error serializer, which silently
            // dropped a plain string here — the dropped message's cause vanished from the log,
            // and this log line is the only record that it was dropped at all.
            reason: e instanceof Error ? e.message : String(e),
          },
          'scheduled email failed to send',
        );
      }
    }
    this.logger.log(
      { jobId: job.id, jobName: job.name, sent, failed: failed.length },
      'scheduled email batch finished',
    );
  }

  private async sendWeeklySummaries(job: Job): Promise<void> {
    if (!this.canSend(job)) return;
    const week = reportedWeek(job);
    const summaries = await collectWeeklySummaries(
      this.prisma,
      week,
      this.env.TRACKING_FRESHNESS_SECONDS,
    );

    const messages: OutboundEmail[] = [];
    for (const summary of summaries) {
      if (summary.recipients.length === 0) {
        // A team with active members but no active MANAGER has nobody to report to. Say so
        // loudly — silently skipping it looks identical to the feature working.
        this.logger.warn(
          { jobId: job.id, teamId: summary.teamId, members: summary.members.length },
          'team has no active manager — weekly summary has no recipient',
        );
        continue;
      }
      for (const recipient of summary.recipients) {
        const mail = renderWeeklySummaryEmail({
          recipientName: recipient.name,
          teamName: summary.teamName,
          week,
          members: summary.members,
          pendingApprovals: summary.pendingApprovals,
          appUrl: this.env.APP_URL,
        });
        messages.push({ to: recipient.email, ...mail });
      }
    }
    await this.deliver(job, messages);
  }

  private async sendMissingTimesheetReminders(job: Job): Promise<void> {
    if (!this.canSend(job)) return;
    const week = reportedWeek(job);
    const targets = await collectMissingTimesheets(
      this.prisma,
      week,
      this.env.TRACKING_FRESHNESS_SECONDS,
    );
    if (targets.length === 0) {
      // Expected on a default install: the threshold ships at 0 (off).
      this.logger.log({ jobId: job.id }, 'no missing-timesheet reminders due');
      return;
    }

    const messages = targets.map((target) => ({
      to: target.email,
      ...renderMissingTimesheetEmail({
        name: target.name,
        week,
        trackedSeconds: target.trackedSeconds,
        thresholdHours: target.thresholdHours,
        appUrl: this.env.APP_URL,
      }),
    }));
    await this.deliver(job, messages);
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

    // Throws on failure so BullMQ retries (3 attempts, exponential backoff). Safe here and
    // not in `deliver`: an invite job is exactly one message, so a retry cannot duplicate.
    await this.mailer.send({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log({ jobId: job.id, email }, 'invite email sent');
  }
}
