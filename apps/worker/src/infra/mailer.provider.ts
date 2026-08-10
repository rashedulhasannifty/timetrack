import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv, smtpConfig } from '@timetrack/config';

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Worker-side outbound email (CLAUDE.md §3 — the worker owns its infra; apps never import
 * each other). Mirrors WorkerS3's shape: env is read once, the transport is built once.
 *
 * SMTP so any provider works and the credentials match the shape already used elsewhere in
 * the estate. With SES this is the SMTP endpoint, whose password is derived from the IAM
 * secret and is NOT the IAM secret itself.
 *
 * Sending is OPTIONAL. `smtpConfig` returns null when unconfigured, `enabled` is then false,
 * and callers fall back to logging the link — a development path. A half-configured state
 * cannot reach here: packages/config rejects it at boot.
 */
@Injectable()
export class Mailer {
  private readonly smtp = smtpConfig(loadEnv());
  private readonly transport: Transporter | null =
    this.smtp === null
      ? null
      : createTransport({
          host: this.smtp.host,
          port: this.smtp.port,
          // 465 is implicit TLS; 587 upgrades via STARTTLS, which we require rather than
          // allow — an opportunistic downgrade would send credentials in the clear.
          secure: this.smtp.secure,
          requireTLS: !this.smtp.secure,
          auth: { user: this.smtp.user, pass: this.smtp.pass },
        });

  /** Whether SMTP is configured. False → `send` throws; check this first. */
  get enabled(): boolean {
    return this.transport !== null;
  }

  /**
   * Send one message. Throws on any SMTP failure so BullMQ's retry/backoff (3 attempts,
   * exponential) applies — a dropped invite is worse than a retried one.
   */
  async send(mail: OutboundEmail): Promise<void> {
    if (this.transport === null || this.smtp === null) {
      throw new Error('Mailer.send called while SMTP is not configured');
    }
    await this.transport.sendMail({
      from: this.smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }
}
