import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@timetrack/contracts';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { closedWeek } from '../src/processors/email/closed-week.js';
import { collectWeeklySummaries } from '../src/processors/email/weekly-summary.js';
import { collectMissingTimesheets } from '../src/processors/email/missing-timesheet.js';

const RUN_E2E = process.env.RUN_E2E === '1'; // worker e2e specs gate on this (see rollup-daily.e2e-spec.ts)

// 08:00 on Monday 2026-08-10 — the scheduled moment. The closed week is 2026-08-03 → 08-10.
const NOW = new Date('2026-08-10T08:00:00.000Z');
const WEEK = closedWeek(NOW);
// Everyone in the fixture joined well before the week, unless a test says otherwise: the
// reminder only considers people who were on the roster for the whole week.
const JOINED = new Date('2026-01-01T00:00:00.000Z');
// TRACKING_FRESHNESS_SECONDS' default (packages/config). The processor reads it from env; the
// collectors take it as a parameter so a spec can state the window it is asserting against.
const FRESHNESS = 300;

describe.runIf(RUN_E2E)('weekly email collection (real Postgres)', () => {
  let env: WorkerTestEnv;
  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  afterEach(async () => {
    await env.prisma.timesheetApproval.deleteMany();
    await env.prisma.activityDailySummary.deleteMany();
    await env.prisma.timeEntry.deleteMany();
    await env.prisma.user.deleteMany();
    await env.prisma.team.deleteMany();
  });

  async function team(name: string, reminderHours?: number) {
    return env.prisma.team.create({
      data: {
        name,
        settings: reminderHours === undefined ? {} : { timesheetReminderHours: reminderHours },
      },
      select: { id: true },
    });
  }

  async function user(
    teamId: string,
    name: string,
    opts: { role?: Role; deactivated?: boolean; createdAt?: Date } = {},
  ) {
    return env.prisma.user.create({
      data: {
        email: `${name.toLowerCase()}@example.com`,
        name,
        passwordHash: 'x',
        teamId,
        role: opts.role ?? 'EMPLOYEE',
        createdAt: opts.createdAt ?? JOINED,
        deactivatedAt: opts.deactivated ? new Date() : null,
      },
      select: { id: true, name: true, email: true },
    });
  }

  let entrySeq = 0;
  async function entry(userId: string, startIso: string, endIso: string) {
    entrySeq += 1;
    await env.prisma.timeEntry.create({
      data: {
        id: `019797a0-0000-7000-8000-${String(entrySeq).padStart(12, '0')}`,
        userId,
        source: 'MANUAL',
        startTime: new Date(startIso),
        endTime: new Date(endIso),
      },
    });
  }

  /**
   * A STRANDED open entry: started, never stopped, and the client stopped heartbeating (crash,
   * shutdown, sleep). `heartbeatAt: null` models a row written before the heartbeat migration,
   * which falls back to `startTime`.
   */
  async function openEntry(userId: string, startIso: string, heartbeatIso: string | null) {
    entrySeq += 1;
    await env.prisma.timeEntry.create({
      data: {
        id: `019797a0-0000-7000-8000-${String(entrySeq).padStart(12, '0')}`,
        userId,
        source: 'MANUAL',
        startTime: new Date(startIso),
        endTime: null,
        heartbeatAt: heartbeatIso === null ? null : new Date(heartbeatIso),
      },
    });
  }

  async function daySummary(userId: string, day: string, pct: number, activeMinutes: number) {
    await env.prisma.activityDailySummary.create({
      data: {
        userId,
        day: new Date(`${day}T00:00:00.000Z`),
        avgActivityPct: pct,
        activeMinutes,
        byApp: {},
        byCategory: {},
      },
    });
  }

  describe('collectWeeklySummaries', () => {
    it('groups active members by team and addresses only that team’s MANAGERs', async () => {
      const eng = await team('Engineering');
      const sup = await team('Support');
      await user(eng.id, 'Mgr', { role: 'MANAGER' });
      await user(eng.id, 'Ada');
      await user(eng.id, 'Gone', { deactivated: true });
      await user(sup.id, 'Sup', { role: 'MANAGER' });
      await user(sup.id, 'Admin', { role: 'ADMIN' });

      const summaries = await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS);
      const byName = new Map(summaries.map((s) => [s.teamName, s]));

      expect([...byName.keys()].sort()).toEqual(['Engineering', 'Support']);
      expect(byName.get('Engineering')!.recipients.map((r) => r.email)).toEqual([
        'mgr@example.com',
      ]);
      // The deactivated member is gone from the roster entirely.
      expect(byName.get('Engineering')!.members.map((m) => m.name)).toEqual(['Ada', 'Mgr']);
      // An ADMIN is a member of the report but not a recipient of it.
      expect(byName.get('Support')!.recipients.map((r) => r.email)).toEqual(['sup@example.com']);
      expect(
        byName
          .get('Support')!
          .members.map((m) => m.name)
          .sort(),
      ).toEqual(['Admin', 'Sup']);
    });

    it('clamps tracked time to the week and sorts the busiest member first', async () => {
      const eng = await team('Engineering');
      await user(eng.id, 'Mgr', { role: 'MANAGER' });
      const ada = await user(eng.id, 'Ada');
      const zoe = await user(eng.id, 'Zoe');

      // 4h inside the week.
      await entry(ada.id, '2026-08-04T09:00:00Z', '2026-08-04T13:00:00Z');
      // Straddles the start boundary: 22:00 Sunday → 02:00 Monday. Only the 2h inside counts.
      await entry(ada.id, '2026-08-02T22:00:00Z', '2026-08-03T02:00:00Z');
      // Entirely after the week closed — excluded.
      await entry(ada.id, '2026-08-11T09:00:00Z', '2026-08-11T17:00:00Z');
      await entry(zoe.id, '2026-08-05T09:00:00Z', '2026-08-05T10:00:00Z');

      const [summary] = await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS);
      expect(summary!.members.map((m) => [m.name, m.trackedSeconds])).toEqual([
        ['Ada', 6 * 3600],
        ['Zoe', 3600],
        ['Mgr', 0], // a member who tracked nothing is still reported
      ]);
    });

    it('bounds a stranded open entry at its last heartbeat, not at the period end', async () => {
      const eng = await team('Engineering');
      await user(eng.id, 'Mgr', { role: 'MANAGER' });
      const ada = await user(eng.id, 'Ada');
      const zoe = await user(eng.id, 'Zoe');

      // Started 09:00 Monday, last heartbeat 09:03, then the Mac went away. Unclamped this
      // reports periodEnd - startTime (~159 hours) in an automated email nobody reviews.
      await openEntry(ada.id, '2026-08-03T09:00:00Z', '2026-08-03T09:03:00Z');
      // A row predating the heartbeat migration falls back to startTime.
      await openEntry(zoe.id, '2026-08-03T09:00:00Z', null);

      const [summary] = await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS);
      const byName = new Map(summary!.members.map((m) => [m.name, m.trackedSeconds]));
      expect(byName.get('Ada')).toBe(3 * 60 + FRESHNESS);
      expect(byName.get('Zoe')).toBe(FRESHNESS);
    });

    it('weights activity by each day’s active minutes and ignores days outside the week', async () => {
      const eng = await team('Engineering');
      await user(eng.id, 'Mgr', { role: 'MANAGER' });
      const ada = await user(eng.id, 'Ada');

      await daySummary(ada.id, '2026-08-03', 80, 300);
      await daySummary(ada.id, '2026-08-04', 40, 100);
      // periodEnd is 08-10, exclusive. A big 0% day there must not drag the average down.
      await daySummary(ada.id, '2026-08-10', 0, 500);

      const [summary] = await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS);
      const ada2 = summary!.members.find((m) => m.name === 'Ada')!;
      // (80*300 + 40*100) / 400 = 70
      expect(ada2.activityPct).toBe(70);
      // No rollup at all is null, not 0 — "no data" and "idle" are different facts.
      expect(summary!.members.find((m) => m.name === 'Mgr')!.activityPct).toBeNull();
    });

    it('counts only this week’s PENDING approvals, per team', async () => {
      const eng = await team('Engineering');
      const sup = await team('Support');
      await user(eng.id, 'Mgr', { role: 'MANAGER' });
      const ada = await user(eng.id, 'Ada');
      const zoe = await user(eng.id, 'Zoe');
      await user(sup.id, 'Sup', { role: 'MANAGER' });

      const approval = (userId: string, periodStart: string, status: 'PENDING' | 'APPROVED') =>
        env.prisma.timesheetApproval.create({
          data: {
            userId,
            periodStart: new Date(periodStart),
            periodEnd: new Date(new Date(periodStart).getTime() + 7 * 86_400_000),
            status,
          },
        });

      await approval(ada.id, '2026-08-03T00:00:00Z', 'PENDING'); // counts
      await approval(zoe.id, '2026-08-03T00:00:00Z', 'APPROVED'); // already decided
      await approval(ada.id, '2026-07-27T00:00:00Z', 'PENDING'); // a different week

      const summaries = await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS);
      const byName = new Map(summaries.map((s) => [s.teamName, s]));
      expect(byName.get('Engineering')!.pendingApprovals).toBe(1);
      expect(byName.get('Support')!.pendingApprovals).toBe(0);
    });

    it('returns nothing when there are no active users at all', async () => {
      const eng = await team('Engineering');
      await user(eng.id, 'Gone', { deactivated: true });
      expect(await collectWeeklySummaries(env.prisma, WEEK, FRESHNESS)).toEqual([]);
    });
  });

  describe('collectMissingTimesheets', () => {
    it('is off for a team that has not set a threshold', async () => {
      const eng = await team('Engineering'); // settings {} → timesheetReminderHours 0
      await user(eng.id, 'Ada');
      expect(await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS)).toEqual([]);
    });

    it('is off when an admin explicitly sets the threshold to 0', async () => {
      const eng = await team('Engineering', 0);
      await user(eng.id, 'Ada');
      expect(await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS)).toEqual([]);
    });

    it('targets only employees under their own team’s threshold', async () => {
      const eng = await team('Engineering', 20);
      const sup = await team('Support'); // reminders off
      const ada = await user(eng.id, 'Ada'); // 4h → under 20
      const busy = await user(eng.id, 'Busy'); // 20h exactly → NOT under
      await user(eng.id, 'Zoe'); // nothing tracked → under
      await user(eng.id, 'Mgr', { role: 'MANAGER' }); // reviewer, not reminded
      await user(eng.id, 'Boss', { role: 'ADMIN' }); // reviewer, not reminded
      await user(eng.id, 'Gone', { deactivated: true }); // off the roster
      await user(sup.id, 'Sam'); // team has reminders off

      await entry(ada.id, '2026-08-04T09:00:00Z', '2026-08-04T13:00:00Z');
      await entry(busy.id, '2026-08-04T00:00:00Z', '2026-08-04T20:00:00Z');
      await entry(busy.id, '2026-08-05T00:00:00Z', '2026-08-05T04:00:00Z');

      const targets = await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS);
      expect(targets.map((t) => [t.name, t.trackedSeconds])).toEqual([
        ['Ada', 4 * 3600],
        ['Zoe', 0],
      ]);
      expect(targets.every((t) => t.thresholdHours === 20)).toBe(true);
    });

    it('skips someone who joined mid-week — they could not have reached a full-week target', async () => {
      const eng = await team('Engineering', 20);
      await user(eng.id, 'Newbie', { createdAt: new Date('2026-08-05T09:00:00Z') });
      await user(eng.id, 'Ada'); // joined long before, tracked nothing → reminded
      expect(
        (await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS)).map((t) => t.name),
      ).toEqual(['Ada']);
    });

    it('does not let a stranded open entry satisfy the threshold', async () => {
      const eng = await team('Engineering', 20);
      const ada = await user(eng.id, 'Ada');
      // Unclamped this is ~159 hours, so Ada clears any threshold and is never chased for the
      // timesheet she in fact never filled in.
      await openEntry(ada.id, '2026-08-03T09:00:00Z', '2026-08-03T09:03:00Z');

      const targets = await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS);
      expect(targets.map((t) => [t.name, t.trackedSeconds])).toEqual([['Ada', 3 * 60 + FRESHNESS]]);
    });

    it('does not count time tracked outside the closed week toward the threshold', async () => {
      const eng = await team('Engineering', 5);
      const ada = await user(eng.id, 'Ada');
      // A big week AFTER the reported one does not excuse the reported one.
      await entry(ada.id, '2026-08-11T09:00:00Z', '2026-08-11T19:00:00Z');
      expect(
        (await collectMissingTimesheets(env.prisma, WEEK, FRESHNESS)).map((t) => t.name),
      ).toEqual(['Ada']);
    });
  });
});
