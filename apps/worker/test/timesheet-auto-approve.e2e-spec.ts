import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR_ID } from '@timetrack/contracts';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { autoApprovePendingTimesheets } from '../src/processors/timesheet-auto-approve.js';

const RUN_E2E = process.env.RUN_E2E === '1';

// The Dhaka week of Monday 2026-07-06 ran [07-05T18:00Z, 07-12T18:00Z).
const P_START = new Date('2026-07-05T18:00:00.000Z');
const P_END = new Date('2026-07-12T18:00:00.000Z');
// Four days after the period closed — past a 3-day grace period.
const NOW = new Date('2026-07-16T19:00:00.000Z');
const FRESHNESS = 300;

describe.runIf(RUN_E2E)('autoApprovePendingTimesheets (real Postgres)', () => {
  let env: WorkerTestEnv;
  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  afterEach(async () => {
    await env.prisma.auditLog.deleteMany();
    await env.prisma.timesheetApproval.deleteMany();
    await env.prisma.idleEvent.deleteMany();
    await env.prisma.timeEntry.deleteMany();
    await env.prisma.user.deleteMany();
    await env.prisma.team.deleteMany();
  });

  async function team(settings: Record<string, unknown> = {}) {
    return env.prisma.team.create({
      data: {
        name: 'Eng',
        settings: {
          autoApproveTimesheets: true,
          autoApproveAfterDays: 3,
          autoApproveMaxHours: 60,
          timesheetReminderHours: 0,
          ...settings,
        },
      },
      select: { id: true },
    });
  }
  async function user(teamId: string, email = 'ada@example.com') {
    return env.prisma.user.create({
      data: { email, name: 'Ada', passwordHash: 'x', teamId },
      select: { id: true },
    });
  }
  async function approval(userId: string, status: 'PENDING' | 'FLAGGED' = 'PENDING') {
    return env.prisma.timesheetApproval.create({
      data: { userId, periodStart: P_START, periodEnd: P_END, status },
      select: { id: true },
    });
  }
  /** `hours` of tracked time inside the period, as one closed entry. */
  async function work(userId: string, id: string, hours: number) {
    const start = new Date('2026-07-06T03:00:00.000Z');
    await env.prisma.timeEntry.create({
      data: {
        id,
        userId,
        source: 'MANUAL',
        startTime: start,
        endTime: new Date(start.getTime() + hours * 3600_000),
      },
    });
  }

  it('approves a settled week, snapshots the total, and audits it as the system actor', async () => {
    const t = await team();
    const ada = await user(t.id);
    const ts = await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d001', 8);

    const outcome = await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(outcome.approved).toBe(1);

    const row = await env.prisma.timesheetApproval.findUniqueOrThrow({ where: { id: ts.id } });
    expect(row.status).toBe('APPROVED');
    expect(row.totalSeconds).toBe(8 * 3600);
    expect(row.reviewerId).toBeNull(); // no human decided it
    expect(row.decidedAt).not.toBeNull();

    const audit = await env.prisma.auditLog.findFirstOrThrow({ where: { targetId: ts.id } });
    expect(audit.action).toBe('timesheet.auto-approve');
    expect(audit.actorId).toBe(SYSTEM_ACTOR_ID);
  });

  it('leaves a week alone until the grace period has passed', async () => {
    const t = await team({ autoApproveAfterDays: 7 });
    const ada = await user(t.id);
    await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d002', 8);

    expect((await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS)).approved).toBe(0);
    // ...and picks it up once it has.
    const later = new Date('2026-07-20T19:00:00.000Z');
    expect((await autoApprovePendingTimesheets(env.prisma, later, FRESHNESS)).approved).toBe(1);
  });

  it('never touches a team that has not switched auto-approve on', async () => {
    const t = await team({ autoApproveTimesheets: false });
    const ada = await user(t.id);
    await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d003', 8);

    expect((await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS)).approved).toBe(0);
  });

  it('never re-decides a row a human already decided', async () => {
    const t = await team();
    const ada = await user(t.id);
    const ts = await approval(ada.id, 'FLAGGED');
    await work(ada.id, '019797a0-0000-7000-8000-00000000d004', 8);

    expect((await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS)).approved).toBe(0);
    const row = await env.prisma.timesheetApproval.findUniqueOrThrow({ where: { id: ts.id } });
    expect(row.status).toBe('FLAGGED');
  });

  it('escalates a week containing an unresolved idle window', async () => {
    const t = await team();
    const ada = await user(t.id);
    await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d005', 8);
    await env.prisma.idleEvent.create({
      data: {
        id: '019797a0-0000-7000-8000-00000000e005',
        userId: ada.id,
        startTime: new Date('2026-07-06T05:00:00.000Z'),
        endTime: new Date('2026-07-06T05:30:00.000Z'),
        resolvedAction: 'UNRESOLVED',
      },
    });

    const outcome = await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(outcome.approved).toBe(0);
    expect(outcome.skipped['unresolved-idle']).toBe(1);
  });

  it('escalates an implausibly full week rather than rubber-stamping it', async () => {
    const t = await team({ autoApproveMaxHours: 60 });
    const ada = await user(t.id);
    await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d006', 100);

    const outcome = await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(outcome.approved).toBe(0);
    expect(outcome.skipped['above-ceiling']).toBe(1);
  });

  it('escalates a week below the team floor', async () => {
    const t = await team({ timesheetReminderHours: 20 });
    const ada = await user(t.id);
    await approval(ada.id);
    await work(ada.id, '019797a0-0000-7000-8000-00000000d007', 5);

    const outcome = await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(outcome.approved).toBe(0);
    expect(outcome.skipped['below-floor']).toBe(1);
  });

  it('counts overlapping entries once, like every other tracked-time total', async () => {
    const t = await team();
    const ada = await user(t.id);
    const ts = await approval(ada.id);
    const base = new Date('2026-07-06T03:00:00.000Z');
    await env.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-00000000d008',
        userId: ada.id,
        source: 'MANUAL',
        startTime: base,
        endTime: new Date(base.getTime() + 4 * 3600_000),
      },
    });
    await env.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-00000000d009',
        userId: ada.id,
        source: 'MANUAL',
        startTime: new Date(base.getTime() + 2 * 3600_000),
        endTime: new Date(base.getTime() + 6 * 3600_000),
      },
    });

    await autoApprovePendingTimesheets(env.prisma, NOW, FRESHNESS);
    const row = await env.prisma.timesheetApproval.findUniqueOrThrow({ where: { id: ts.id } });
    expect(row.totalSeconds).toBe(6 * 3600); // a naive SUM would snapshot 8h
  });
});
