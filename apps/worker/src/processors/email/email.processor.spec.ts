import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = { value: { APP_URL: 'https://timer.niftyitsolution.com', NODE_ENV: 'production' } };
vi.mock('@timetrack/config', () => ({ loadEnv: () => env.value }));

// The collect* functions own the SQL and are covered against real Postgres in
// test/weekly-emails.e2e-spec.ts. Stubbing just those two keeps THIS spec about dispatch,
// fan-out and failure handling — the renderers stay real, so the assertions below are made
// against the bytes that would actually be sent.
vi.mock('./weekly-summary.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./weekly-summary.js')>()),
  collectWeeklySummaries: vi.fn(),
}));
vi.mock('./missing-timesheet.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./missing-timesheet.js')>()),
  collectMissingTimesheets: vi.fn(),
}));

import { EmailProcessor } from './email.processor.js';
import { collectWeeklySummaries, type TeamWeeklySummary } from './weekly-summary.js';
import { collectMissingTimesheets, type ReminderTarget } from './missing-timesheet.js';
import type { Mailer } from '../../infra/mailer.provider.js';
import type { WorkerPrisma } from '../../infra/prisma.provider.js';
import type { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';

function makeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function makeMailer(enabled = true): Mailer {
  return { enabled, send: vi.fn().mockResolvedValue(undefined) } as unknown as Mailer;
}

const prisma = {} as unknown as WorkerPrisma;

function makeProcessor(logger: Logger, mailer: Mailer): EmailProcessor {
  return new EmailProcessor(logger, mailer, prisma);
}

/** Recipients of sent mail, in send order. */
function sentTo(mailer: Mailer): string[] {
  return vi.mocked(mailer.send).mock.calls.map((c) => c[0].to);
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

// 08:00 Monday 2026-08-10 — the scheduled moment. Reports the week 3–9 Aug 2026.
const summaryJob = {
  id: 'j-sum',
  name: 'weekly-summary',
  data: { now: '2026-08-10T08:00:00.000Z' },
} as unknown as Job;

const reminderJob = {
  id: 'j-rem',
  name: 'missing-timesheet',
  data: { now: '2026-08-10T09:00:00.000Z' },
} as unknown as Job;

function team(name: string, managers: string[], members = 3): TeamWeeklySummary {
  return {
    teamId: `t-${name}`,
    teamName: name,
    recipients: managers.map((email) => ({ name: email.split('@')[0]!, email })),
    members: Array.from({ length: members }, (_, i) => ({
      userId: `u${i}`,
      name: `Member ${i}`,
      trackedSeconds: 3600 * (i + 1),
      activityPct: null,
    })),
    pendingApprovals: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  env.value = { APP_URL: 'https://timer.niftyitsolution.com', NODE_ENV: 'production' };
  vi.mocked(collectWeeklySummaries).mockResolvedValue([]);
  vi.mocked(collectMissingTimesheets).mockResolvedValue([]);
});

describe('EmailProcessor invite job', () => {
  it('sends to the invitee with the accept link built from APP_URL', async () => {
    const mailer = makeMailer();
    await makeProcessor(makeLogger(), mailer).process(inviteJob);

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
    await expect(makeProcessor(makeLogger(), mailer).process(inviteJob)).rejects.toThrow(
      'SES throttled',
    );
  });

  it('does not send, and never logs the token, when email is unconfigured in production', async () => {
    const mailer = makeMailer(false);
    const logger = makeLogger();
    await makeProcessor(logger, mailer).process(inviteJob);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('tok-123');
  });

  it('logs the accept link when email is unconfigured in development', async () => {
    env.value = { APP_URL: 'http://localhost:3000', NODE_ENV: 'development' };
    const mailer = makeMailer(false);
    const logger = makeLogger();
    await makeProcessor(logger, mailer).process(inviteJob);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain(
      'http://localhost:3000/accept-invite?token=tok-123',
    );
  });

  it('drops a malformed payload instead of burning retries', async () => {
    const mailer = makeMailer();
    const logger = makeLogger();
    const bad = { id: 'j2', name: 'invite', data: { email: 'x@y.z' } } as unknown as Job;
    await expect(makeProcessor(logger, mailer).process(bad)).resolves.toBeUndefined();

    expect(mailer.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('EmailProcessor weekly-summary job', () => {
  it('sends one mail per manager, per team, for the week that just closed', async () => {
    vi.mocked(collectWeeklySummaries).mockResolvedValue([
      team('Engineering', ['mgr-a@ex.co', 'mgr-b@ex.co']),
      team('Support', ['mgr-c@ex.co']),
    ]);
    const mailer = makeMailer();
    await makeProcessor(makeLogger(), mailer).process(summaryJob);

    expect(sentTo(mailer)).toEqual(['mgr-a@ex.co', 'mgr-b@ex.co', 'mgr-c@ex.co']);
    const first = vi.mocked(mailer.send).mock.calls[0]![0];
    expect(first.subject).toBe('TimeTrack weekly summary — Engineering, 3–9 Aug 2026');
  });

  it('reports the previous week even though it runs minutes into the new one', async () => {
    vi.mocked(collectWeeklySummaries).mockResolvedValue([team('Engineering', ['m@ex.co'])]);
    const mailer = makeMailer();
    await makeProcessor(makeLogger(), mailer).process(summaryJob);

    const week = vi.mocked(collectWeeklySummaries).mock.calls[0]![1];
    expect(week.periodStart.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    expect(week.periodEnd.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('warns and skips a team whose only manager is gone, rather than failing silently', async () => {
    vi.mocked(collectWeeklySummaries).mockResolvedValue([
      team('Orphaned', []),
      team('Support', ['mgr-c@ex.co']),
    ]);
    const mailer = makeMailer();
    const logger = makeLogger();
    await makeProcessor(logger, mailer).process(summaryJob);

    expect(sentTo(mailer)).toEqual(['mgr-c@ex.co']);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('no active manager');
  });

  it('does not rethrow when one recipient fails — a retry would re-send the rest', async () => {
    vi.mocked(collectWeeklySummaries).mockResolvedValue([
      team('Engineering', ['ok-1@ex.co', 'broken@ex.co', 'ok-2@ex.co']),
    ]);
    const mailer = makeMailer();
    vi.mocked(mailer.send).mockImplementation((mail) =>
      mail.to === 'broken@ex.co'
        ? Promise.reject(new Error('550 mailbox unavailable'))
        : Promise.resolve(),
    );
    const logger = makeLogger();

    await expect(makeProcessor(logger, mailer).process(summaryJob)).resolves.toBeUndefined();
    // Every recipient was attempted, including the ones after the failure.
    expect(sentTo(mailer)).toEqual(['ok-1@ex.co', 'broken@ex.co', 'ok-2@ex.co']);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).toContain('broken@ex.co');
    expect(JSON.stringify(vi.mocked(logger.log).mock.calls)).toContain('"sent":2');
  });

  it('never touches the database when email is unconfigured', async () => {
    const mailer = makeMailer(false);
    const logger = makeLogger();
    await makeProcessor(logger, mailer).process(summaryJob);

    expect(collectWeeklySummaries).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe('EmailProcessor missing-timesheet job', () => {
  const target: ReminderTarget = {
    userId: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@ex.co',
    trackedSeconds: 4 * 3600,
    thresholdHours: 20,
  };

  it('sends one reminder to each employee under their team threshold', async () => {
    vi.mocked(collectMissingTimesheets).mockResolvedValue([
      target,
      { ...target, userId: 'u2', name: 'Grace', email: 'grace@ex.co', trackedSeconds: 0 },
    ]);
    const mailer = makeMailer();
    await makeProcessor(makeLogger(), mailer).process(reminderJob);

    expect(sentTo(mailer)).toEqual(['ada@ex.co', 'grace@ex.co']);
    const first = vi.mocked(mailer.send).mock.calls[0]![0];
    expect(first.subject).toBe('Your TimeTrack hours for 3–9 Aug 2026 look incomplete');
    expect(first.text).toContain('20-hour mark');
  });

  it('sends nothing when no employee is under threshold (the default install)', async () => {
    const mailer = makeMailer();
    const logger = makeLogger();
    await makeProcessor(logger, mailer).process(reminderJob);

    expect(mailer.send).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.log).mock.calls)).toContain(
      'no missing-timesheet reminders due',
    );
  });

  it('does not rethrow when one reminder fails', async () => {
    vi.mocked(collectMissingTimesheets).mockResolvedValue([
      { ...target, email: 'broken@ex.co' },
      { ...target, userId: 'u2', email: 'ok@ex.co' },
    ]);
    const mailer = makeMailer();
    vi.mocked(mailer.send).mockImplementation((mail) =>
      mail.to === 'broken@ex.co' ? Promise.reject(new Error('timeout')) : Promise.resolve(),
    );

    await expect(makeProcessor(makeLogger(), mailer).process(reminderJob)).resolves.toBeUndefined();
    expect(sentTo(mailer)).toEqual(['broken@ex.co', 'ok@ex.co']);
  });

  it('never touches the database when email is unconfigured', async () => {
    const mailer = makeMailer(false);
    await makeProcessor(makeLogger(), mailer).process(reminderJob);
    expect(collectMissingTimesheets).not.toHaveBeenCalled();
  });
});

describe('EmailProcessor dispatch', () => {
  it('warns on an unknown job name instead of throwing', async () => {
    const logger = makeLogger();
    const mailer = makeMailer();
    const job = { id: 'j9', name: 'nope', data: {} } as unknown as Job;

    await expect(makeProcessor(logger, mailer).process(job)).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('unknown email job');
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('falls back to the real clock when the job carries an unparseable now', async () => {
    const bad = { id: 'j8', name: 'weekly-summary', data: { now: 'not-a-date' } } as unknown as Job;
    await expect(makeProcessor(makeLogger(), makeMailer()).process(bad)).resolves.toBeUndefined();

    const week = vi.mocked(collectWeeklySummaries).mock.calls[0]![1];
    expect(week.periodEnd.getTime()).toBeLessThanOrEqual(Date.now());
    expect(week.periodStart.getUTCDay()).toBe(1); // still a Monday
  });
});
