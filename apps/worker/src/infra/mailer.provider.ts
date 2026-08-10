import { Injectable } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { loadEnv, sesConfig } from '@timetrack/config';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Worker-side outbound email (CLAUDE.md §3 — the worker owns its infra; apps never import
 * each other). Mirrors WorkerS3's shape: env is read once, the client is built once.
 *
 * Sending is OPTIONAL. `sesConfig` returns null when SES is unconfigured, `enabled` is then
 * false, and callers fall back to logging the link — a development path. A half-configured
 * state cannot reach here: packages/config rejects it at boot.
 */
@Injectable()
export class Mailer {
  private readonly ses = sesConfig(loadEnv());
  private readonly client =
    this.ses === null
      ? null
      : new SESv2Client({
          region: this.ses.region,
          credentials: {
            accessKeyId: this.ses.accessKeyId,
            secretAccessKey: this.ses.secretAccessKey,
          },
        });

  /** Whether SES is configured. False → `send` throws; check this first. */
  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Send one message. Throws on any SES failure so BullMQ's retry/backoff (3 attempts,
   * exponential) applies — a dropped invite is worse than a retried one.
   */
  async send(mail: OutboundEmail): Promise<void> {
    if (this.client === null || this.ses === null) {
      throw new Error('Mailer.send called while SES is not configured');
    }
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.ses.from,
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: mail.text, Charset: 'UTF-8' },
              Html: { Data: mail.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }
}
