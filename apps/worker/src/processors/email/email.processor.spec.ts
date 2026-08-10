import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = { value: { APP_URL: 'https://timer.niftyitsolution.com', NODE_ENV: 'production' } };
vi.mock('@timetrack/config', () => ({ loadEnv: () => env.value }));

import { EmailProcessor } from './email.processor.js';
import type { Mailer } from '../../infra/mailer.provider.js';
import type { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';

function makeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function makeMailer(enabled = true): Mailer {
  return { enabled, send: vi.fn().mockResolvedValue(undefined) } as unknown as Mailer;
}

const inviteJob = {
  id: 'j1',
  name: 'invite',
  data: {
    email: 'new@ex.co',
    name: 'New Hire',
    inviteToken: 'tok-123',
    expiresAt: '2026-08-17T00:00:00.000Z',
  },
} as unknown as Job;

beforeEach(() => {
  vi.clearAllMocks();
  env.value = { APP_URL: 'https://timer.niftyitsolution.com', NODE_ENV: 'production' };
});

describe('EmailProcessor invite job', () => {
  it('sends to the invitee with the accept link built from APP_URL', async () => {
    const mailer = makeMailer();
    await new EmailProcessor(makeLogger(), mailer).process(inviteJob);

    expect(mailer.send).toHaveBeenCalledOnce();
    const sent = vi.mocked(mailer.send).mock.calls[0]?.[0];
    expect(sent?.to).toBe('new@ex.co');
    expect(sent?.subject).toBe('You have been invited to TimeTrack');
    expect(sent?.text).toContain('https://timer.niftyitsolution.com/accept-invite?token=tok-123');
    expect(sent?.html).toContain('https://timer.niftyitsolution.com/accept-invite?token=tok-123');
  });

  it('propagates a send failure so BullMQ retries', async () => {
    const mailer = makeMailer();
    vi.mocked(mailer.send).mockRejectedValue(new Error('SES throttled'));
    await expect(new EmailProcessor(makeLogger(), mailer).process(inviteJob)).rejects.toThrow(
      'SES throttled',
    );
  });

  it('does not send, and never logs the token, when email is unconfigured in production', async () => {
    const mailer = makeMailer(false);
    const logger = makeLogger();
    await new EmailProcessor(logger, mailer).process(inviteJob);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('tok-123');
  });

  it('logs the accept link when email is unconfigured in development', async () => {
    env.value = { APP_URL: 'http://localhost:3000', NODE_ENV: 'development' };
    const mailer = makeMailer(false);
    const logger = makeLogger();
    await new EmailProcessor(logger, mailer).process(inviteJob);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain(
      'http://localhost:3000/accept-invite?token=tok-123',
    );
  });

  it('drops a malformed payload instead of burning retries', async () => {
    const mailer = makeMailer();
    const logger = makeLogger();
    const bad = { id: 'j2', name: 'invite', data: { email: 'x@y.z' } } as unknown as Job;
    await expect(new EmailProcessor(logger, mailer).process(bad)).resolves.toBeUndefined();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
