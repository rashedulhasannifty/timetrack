import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { generatePendingTimesheets } from '../src/processors/timesheet-generate.js';

const RUN_E2E = process.env.RUN_E2E === '1'; // worker e2e specs gate on this (see rollup-daily.e2e-spec.ts)

// A fixed "now" on a Wednesday so the current (in-progress) week is excluded and the
// four prior CLOSED ISO weeks are the window. Monday of now's week = 2026-07-13.
const NOW = new Date('2026-07-15T12:00:00.000Z'); // Wed 2026-07-15
const FRESHNESS = 300; // TRACKING_FRESHNESS_SECONDS' default (packages/config)
// Closed weeks in the 4-week window start on: 2026-06-15, 06-22, 06-29, 07-06 (Mondays).

describe.runIf(RUN_E2E)('generatePendingTimesheets (real Postgres)', () => {
  let env: WorkerTestEnv;
  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  afterEach(async () => {
    await env.prisma.timesheetApproval.deleteMany();
    await env.prisma.timeEntry.deleteMany();
    await env.prisma.user.deleteMany();
    await env.prisma.team.deleteMany();
  });

  async function team() {
    return env.prisma.team.create({ data: { name: 'Eng', settings: {} }, select: { id: true } });
  }
  async function user(teamId: string, name: string, email: string, deactivated = false) {
    return env.prisma.user.create({
      data: {
        email,
        name,
        passwordHash: 'x',
        teamId,
        deactivatedAt: deactivated ? new Date() : null,
      },
      select: { id: true },
    });
  }
  async function entry(
    userId: string,
    id: string,
    startIso: string,
    endIso: string | null,
    heartbeatAt: Date | null = null,
  ) {
    await env.prisma.timeEntry.create({
      data: {
        id,
        userId,
        source: 'MANUAL',
        startTime: new Date(startIso),
        endTime: endIso ? new Date(endIso) : null,
        heartbeatAt,
      },
    });
  }

  it('creates one PENDING row per active user per in-window week with tracked time', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    // Two different closed weeks: 06-29 week and 07-06 week.
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000a001',
      '2026-06-30T09:00:00Z',
      '2026-06-30T10:00:00Z',
    );
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000a002',
      '2026-07-07T09:00:00Z',
      '2026-07-07T10:30:00Z',
    );

    const created = await generatePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(created).toBe(2);

    const rows = await env.prisma.timesheetApproval.findMany({
      where: { userId: ada.id },
      orderBy: { periodStart: 'asc' },
      select: { periodStart: true, periodEnd: true, status: true, totalSeconds: true },
    });
    expect(rows.map((r) => r.periodStart.toISOString())).toEqual([
      '2026-06-29T00:00:00.000Z',
      '2026-07-06T00:00:00.000Z',
    ]);
    expect(rows.every((r) => r.status === 'PENDING' && r.totalSeconds === null)).toBe(true);
    expect(rows[0]!.periodEnd.toISOString()).toBe('2026-07-06T00:00:00.000Z'); // start + 7d
  });

  it('skips deactivated users and zero-tracked weeks, and excludes the current in-progress week', async () => {
    const t = await team();
    const gone = await user(t.id, 'Gone', 'gone@example.com', true);
    await entry(
      gone.id,
      '019797a0-0000-7000-8000-00000000a003',
      '2026-06-30T09:00:00Z',
      '2026-06-30T10:00:00Z',
    );
    const live = await user(t.id, 'Liv', 'liv@example.com');
    // entry in the CURRENT (in-progress) week of NOW (Mon 2026-07-13) → excluded
    await entry(
      live.id,
      '019797a0-0000-7000-8000-00000000a004',
      '2026-07-14T09:00:00Z',
      '2026-07-14T10:00:00Z',
    );

    const created = await generatePendingTimesheets(env.prisma, NOW, FRESHNESS);
    expect(created).toBe(0);
    expect(await env.prisma.timesheetApproval.count()).toBe(0);
  });

  it('does not manufacture an approval for a week whose only entry is stranded open', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    // Started in a closed week and never stopped; the client stopped heartbeating.
    await entry(ada.id, '019797a0-0000-7000-8000-00000000a007', '2026-06-30T09:00:00Z', null);

    expect(await generatePendingTimesheets(env.prisma, NOW, FRESHNESS)).toBe(0);
    expect(await env.prisma.timesheetApproval.count()).toBe(0);
  });

  it('still generates for a LIVE open entry that started before the week closed', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    // The counterpart of the test above, and the reason candidacy keys on STALENESS rather
    // than on `endTime IS NULL`: a timer that is still running and still heartbeating is real
    // work. The staleness predicate compares the heartbeat against the SQL clock, so this
    // fixture heartbeats at wall-clock now even though the entry starts in a closed week.
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000a008',
      '2026-06-30T09:00:00Z',
      null,
      new Date(),
    );

    expect(await generatePendingTimesheets(env.prisma, NOW, FRESHNESS)).toBe(1);
  });

  it('is idempotent, never clobbers a decided row, and backfills a late-arriving entry', async () => {
    const t = await team();
    const ada = await user(t.id, 'Ada', 'ada@example.com');
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000a005',
      '2026-06-30T09:00:00Z',
      '2026-06-30T10:00:00Z',
    );

    expect(await generatePendingTimesheets(env.prisma, NOW, FRESHNESS)).toBe(1);
    // decide the generated row
    const gen = await env.prisma.timesheetApproval.findFirstOrThrow({ where: { userId: ada.id } });
    await env.prisma.timesheetApproval.update({
      where: { id: gen.id },
      data: { status: 'APPROVED', totalSeconds: 3600, decidedAt: new Date() },
    });

    // late-arriving entry for a DIFFERENT in-window week (07-06 week)
    await entry(
      ada.id,
      '019797a0-0000-7000-8000-00000000a006',
      '2026-07-07T09:00:00Z',
      '2026-07-07T10:00:00Z',
    );

    // re-run: adds the missing week only, leaves APPROVED row untouched
    expect(await generatePendingTimesheets(env.prisma, NOW, FRESHNESS)).toBe(1);
    const rows = await env.prisma.timesheetApproval.findMany({
      where: { userId: ada.id },
      orderBy: { periodStart: 'asc' },
    });
    expect(rows).toHaveLength(2);
    const approved = rows.find((r) => r.periodStart.toISOString() === '2026-06-29T00:00:00.000Z')!;
    expect(approved.status).toBe('APPROVED'); // not clobbered
    expect(await generatePendingTimesheets(env.prisma, NOW, FRESHNESS)).toBe(0); // fully idempotent now
  });
});
