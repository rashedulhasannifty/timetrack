import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

// A fixed window so the assertions are deterministic (running entries still use now(),
// which is inside this window because the test seeds "today" relative to the window).
const DAY_START = new Date('2026-07-12T00:00:00.000Z');
const DAY_END = new Date('2026-07-13T00:00:00.000Z');

describe.runIf(RUN_E2E)('reports repository — overview (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  function repo(): ReportsRepository {
    return new ReportsRepository(db.prisma as unknown as PrismaService);
  }

  async function seedTeam() {
    return db.prisma.team.create({ data: { name: 'Eng', settings: {} }, select: { id: true } });
  }

  async function seedUser(teamId: string, name: string, email: string) {
    return db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  }

  const WINDOW = 300; // freshnessSeconds for these assertions
  let sampleSeq = 0;
  async function seedSample(userId: string, ts: Date) {
    await db.prisma.activitySample.create({
      data: {
        id: `019797a0-0000-7000-8000-0000000005${String(sampleSeq++).padStart(2, '0')}`,
        userId,
        timestamp: ts,
        appName: 'Code',
        windowTitle: null,
        activityPct: 50,
        category: 'PRODUCTIVE',
      },
    });
  }

  it('sums a closed entry inside the window and flags tracking=false', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000101',
        userId: user.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-12T09:00:00.000Z'),
        endTime: new Date('2026-07-12T10:30:00.000Z'), // 90 min
      },
    });

    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END, WINDOW);
    expect(rows).toEqual([
      { userId: user.id, name: 'Ada', tracking: false, trackedSecondsToday: 5400 },
    ]);
  });

  it('a running entry sets tracking=true and counts live elapsed', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const start = new Date(Date.now() - 60_000); // 1 min ago, endTime null
    // Use a window that certainly contains "now" so the running entry is in range.
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000102',
        userId: user.id,
        source: 'AUTO',
        startTime: start,
        endTime: null,
      },
    });

    await seedSample(user.id, new Date()); // fresh heartbeat within WINDOW
    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    expect(row.tracking).toBe(true);
    expect(row.trackedSecondsToday).toBeGreaterThanOrEqual(59);
    expect(row.trackedSecondsToday).toBeLessThan(120);
  });

  it('an open entry with a stale heartbeat stops accruing trackedSecondsToday', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const dayStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dayEnd = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: '01920000-0000-7000-8000-00000000fc03',
        userId: user.id,
        source: 'MANUAL',
        startTime: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago
        endTime: null,
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // stale, 1h ago
      },
    });

    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    // 30 min start->heartbeat + 300s freshness = 2100s, not the ~5400s an unclamped now()
    // would give.
    expect(row.trackedSecondsToday).toBeGreaterThanOrEqual(2000);
    expect(row.trackedSecondsToday).toBeLessThanOrEqual(2200);
  });

  it('clamps an entry that started before the window', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000103',
        userId: user.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-11T23:00:00.000Z'), // 1h before window
        endTime: new Date('2026-07-12T01:00:00.000Z'), // 1h into window
      },
    });

    const [row] = await repo().overviewForTeam(team.id, DAY_START, DAY_END, WINDOW);
    expect(row.trackedSecondsToday).toBe(3600); // only the in-window hour
  });

  it('includes a zero-entry team member', async () => {
    const team = await seedTeam();
    const a = await seedUser(team.id, 'Ada', 'ada@example.com');
    const b = await seedUser(team.id, 'Bea', 'bea@example.com');
    void a;
    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END, WINDOW);
    const bea = rows.find((r) => r.name === 'Bea');
    expect(bea).toEqual({ userId: b.id, name: 'Bea', tracking: false, trackedSecondsToday: 0 });
  });

  it('overviewForSelf returns only that user', async () => {
    const team = await seedTeam();
    const a = await seedUser(team.id, 'Ada', 'ada@example.com');
    await seedUser(team.id, 'Bea', 'bea@example.com');
    const rows = await repo().overviewForSelf(a.id, DAY_START, DAY_END, WINDOW);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
  });

  it('excludes a deactivated user from the team overview', async () => {
    const team = await seedTeam();
    const active = await seedUser(team.id, 'Ada', 'ada@example.com');
    const deactivated = await db.prisma.user.create({
      data: {
        email: 'cara@example.com',
        name: 'Cara',
        passwordHash: 'x',
        teamId: team.id,
        deactivatedAt: new Date(),
      },
      select: { id: true },
    });
    void deactivated;

    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END, WINDOW);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
    expect(rows).toEqual([
      { userId: active.id, name: 'Ada', tracking: false, trackedSecondsToday: 0 },
    ]);
  });

  it('open entry + fresh heartbeat → tracking=true', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000110',
        userId: user.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 60_000),
        endTime: null,
      },
    });
    await seedSample(user.id, new Date()); // now
    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    expect(row.tracking).toBe(true);
  });

  it('open entry + STALE heartbeat → tracking=false (regression)', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000111',
        userId: user.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 60_000),
        endTime: null, // open, but…
      },
    });
    await seedSample(user.id, new Date(Date.now() - 10 * 60_000)); // 10 min ago, outside WINDOW
    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    expect(row.tracking).toBe(false); // stale heartbeat → not live, regardless of the open entry
  });

  it('fresh heartbeat with NO open entry → tracking=true (the heartbeat is the signal)', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    // Only a CLOSED entry. The macOS client uploads a time entry on stop, never an open one —
    // the live "who's tracking now" signal it emits is the activity-sample heartbeat, so a
    // fresh sample alone means tracking. (Fails against the open-entry-AND SQL, which needs an
    // open entry that a real client never sends.)
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000112',
        userId: user.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 120_000),
        endTime: new Date(Date.now() - 60_000), // closed
      },
    });
    await seedSample(user.id, new Date());
    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    expect(row.tracking).toBe(true);
  });

  it('no heartbeat at all → tracking=false even with a closed entry today', async () => {
    const team = await seedTeam();
    const user = await seedUser(team.id, 'Ada', 'ada@example.com');
    const dayStart = new Date(Date.now() - 3_600_000);
    const dayEnd = new Date(Date.now() + 3_600_000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000113',
        userId: user.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 120_000),
        endTime: new Date(Date.now() - 60_000),
      },
    });
    // no sample seeded
    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd, WINDOW);
    expect(row.tracking).toBe(false);
  });

  describe('trends', () => {
    async function seedSummary(
      userId: string,
      day: string,
      byCategory: Record<string, number>,
      activeMinutes: number,
    ) {
      await db.prisma.activityDailySummary.create({
        data: {
          userId,
          day: new Date(`${day}T00:00:00.000Z`),
          avgActivityPct: 50,
          activeMinutes,
          byApp: {},
          byCategory,
        },
      });
    }

    it('emits one zero-filled row per day and converts category minutes to seconds', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      await db.prisma.timeEntry.create({
        data: {
          id: '019797a0-0000-7000-8000-000000000201',
          userId: user.id,
          source: 'MANUAL',
          startTime: new Date('2026-07-12T09:00:00.000Z'),
          endTime: new Date('2026-07-12T10:00:00.000Z'), // 3600s on the 12th
        },
      });
      await seedSummary(user.id, '2026-07-12', { PRODUCTIVE: 30, UNPRODUCTIVE: 10 }, 40); // minutes

      const days = await repo().trends(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-11T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        WINDOW,
      );

      expect(days.map((d) => d.day)).toEqual(['2026-07-11', '2026-07-12', '2026-07-13']);
      const d12 = days.find((d) => d.day === '2026-07-12')!;
      expect(d12).toEqual({
        day: '2026-07-12',
        trackedSeconds: 3600,
        productiveSeconds: 30 * 60,
        neutralSeconds: 0,
        unproductiveSeconds: 10 * 60,
      });
      const d11 = days.find((d) => d.day === '2026-07-11')!;
      expect(d11).toEqual({
        day: '2026-07-11',
        trackedSeconds: 0,
        productiveSeconds: 0,
        neutralSeconds: 0,
        unproductiveSeconds: 0,
      });
    });

    it('clamps a midnight-spanning entry into each day', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      await db.prisma.timeEntry.create({
        data: {
          id: '019797a0-0000-7000-8000-000000000202',
          userId: user.id,
          source: 'MANUAL',
          startTime: new Date('2026-07-12T23:00:00.000Z'), // 1h on the 12th
          endTime: new Date('2026-07-13T01:00:00.000Z'), // 1h on the 13th
        },
      });
      const days = await repo().trends(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        WINDOW,
      );
      expect(days.find((d) => d.day === '2026-07-12')!.trackedSeconds).toBe(3600);
      expect(days.find((d) => d.day === '2026-07-13')!.trackedSeconds).toBe(3600);
    });

    it('isolates teams: scoping to team A excludes team B tracked and category seconds', async () => {
      const teamA = await seedTeam();
      const teamB = await seedTeam();
      const userA = await seedUser(teamA.id, 'Ada', 'ada@example.com');
      const userB = await seedUser(teamB.id, 'Zoe', 'zoe@example.com');
      await db.prisma.timeEntry.create({
        data: {
          id: '019797a0-0000-7000-8000-000000000210',
          userId: userA.id,
          source: 'MANUAL',
          startTime: new Date('2026-07-12T09:00:00.000Z'),
          endTime: new Date('2026-07-12T10:00:00.000Z'), // 3600s, team A
        },
      });
      await db.prisma.timeEntry.create({
        data: {
          id: '019797a0-0000-7000-8000-000000000211',
          userId: userB.id,
          source: 'MANUAL',
          startTime: new Date('2026-07-12T09:00:00.000Z'),
          endTime: new Date('2026-07-12T11:00:00.000Z'), // 2h, team B — would leak in if unscoped
        },
      });
      await seedSummary(userB.id, '2026-07-12', { PRODUCTIVE: 30 }, 30);

      const days = await repo().trends(
        { kind: 'team', teamId: teamA.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-12T00:00:00.000Z'),
        WINDOW,
      );
      const d12 = days.find((d) => d.day === '2026-07-12')!;
      expect(d12.trackedSeconds).toBe(3600); // only team A's hour
      expect(d12.productiveSeconds).toBe(0); // team B's category summary excluded
    });

    it('an open entry with a stale heartbeat stops accruing duration', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      const staleHeartbeat = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const startTime = new Date(Date.now() - 90 * 60 * 1000); // 90 minutes ago
      await db.prisma.timeEntry.create({
        data: {
          id: '01920000-0000-7000-8000-00000000fc01',
          userId: user.id,
          projectId: null,
          taskId: null,
          source: 'MANUAL',
          startTime,
          endTime: null,
          heartbeatAt: staleHeartbeat,
        },
      });

      const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = new Date(Date.now() + 60 * 60 * 1000);
      const days = await repo().trends({ kind: 'team', teamId: team.id }, from, to, WINDOW);
      const total = days.reduce((sum, d) => sum + d.trackedSeconds, 0);

      // start -> heartbeat is 30 min, plus the 300s freshness window = 1800 + 300 = 2100s.
      // Without the clamp this is ~5400s and climbing every second the process runs.
      expect(total).toBeGreaterThanOrEqual(2000);
      expect(total).toBeLessThanOrEqual(2200);
    });

    it('a legacy open entry with no heartbeatAt contributes at most the freshness window', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Bea', 'bea@example.com');
      await db.prisma.timeEntry.create({
        data: {
          id: '01920000-0000-7000-8000-00000000fc02',
          userId: user.id,
          projectId: null,
          taskId: null,
          source: 'MANUAL',
          startTime: new Date(Date.now() - 90 * 60 * 1000),
          endTime: null,
          heartbeatAt: null, // written before the column existed
        },
      });

      const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = new Date(Date.now() + 60 * 60 * 1000);
      const days = await repo().trends({ kind: 'team', teamId: team.id }, from, to, WINDOW);
      const total = days.reduce((sum, d) => sum + d.trackedSeconds, 0);
      expect(total).toBeLessThanOrEqual(400); // falls back to startTime + 300s
    });

    // NOTE: this is a GUARD, not a regression test for the new predicate — a zero-duration
    // entry already contributes 0 to the SUM whether or not the join admits it (verified:
    // this test still passes with the `te."endTime" > te."startTime"` join predicate removed).
    // Its purpose is to prove the added predicate does NOT collaterally exclude a real open
    // entry sharing the same day, which the trends join has no other direct test for.
    it('a zero-duration entry contributes nothing extra; an open entry the same day still accrues', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Cy', 'cy@example.com');
      const at = new Date('2026-07-12T09:00:00.000Z');
      // A discarded recovery span: closed at its own start (spec §4.4, Task 7's Discard path).
      await db.prisma.timeEntry.create({
        data: {
          id: '01920000-0000-7000-8000-00000000fc03',
          userId: user.id,
          source: 'MANUAL',
          startTime: at,
          endTime: at,
        },
      });
      // A genuinely open entry the same day — must still accrue (the clamp is unaffected).
      await db.prisma.timeEntry.create({
        data: {
          id: '01920000-0000-7000-8000-00000000fc04',
          userId: user.id,
          source: 'AUTO',
          startTime: new Date('2026-07-12T10:00:00.000Z'),
          endTime: null,
          heartbeatAt: new Date('2026-07-12T10:30:00.000Z'),
        },
      });

      const days = await repo().trends(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        WINDOW,
      );
      const d12 = days.find((d) => d.day === '2026-07-12')!;
      // 30 min open + 300s freshness window = 2100s. The zero-duration entry adds nothing.
      expect(d12.trackedSeconds).toBe(30 * 60 + WINDOW);
    });
  });

  describe('team-activity', () => {
    async function seedIdle(userId: string, id: string, start: string, end: string) {
      await db.prisma.idleEvent.create({
        data: {
          id,
          userId,
          startTime: new Date(start),
          endTime: new Date(end),
          resolvedAction: 'KEEP',
        },
      });
    }

    it('computes category % of categorized minutes and idle % of idle+active', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      // 60 categorized min: 45 productive, 15 neutral; 90 active min total.
      await db.prisma.activityDailySummary.create({
        data: {
          userId: user.id,
          day: new Date('2026-07-12T00:00:00.000Z'),
          avgActivityPct: 70,
          activeMinutes: 90,
          byApp: {},
          byCategory: { PRODUCTIVE: 45, NEUTRAL: 15 },
        },
      });
      await seedIdle(
        user.id,
        '019797a0-0000-7000-8000-000000000301',
        '2026-07-12T12:00:00.000Z',
        '2026-07-12T12:10:00.000Z',
      ); // 10 min

      const rows = await repo().teamActivity(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z'),
      );

      expect(rows).toEqual([
        {
          userId: user.id,
          name: 'Ada',
          activeMinutes: 90,
          productivePct: 75,
          neutralPct: 25,
          unproductivePct: 0, // 45/60, 15/60
          idleMinutes: 10,
          idlePct: 10, // 10/(90+10)
        },
      ]);
    });

    it('omits a user with no activity or idle in range', async () => {
      const team = await seedTeam();
      await seedUser(team.id, 'Ghost', 'ghost@example.com');
      const rows = await repo().teamActivity(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z'),
      );
      expect(rows).toEqual([]);
    });

    it('isolates teams: scoping to team A excludes team B users entirely', async () => {
      const teamA = await seedTeam();
      const teamB = await seedTeam();
      const userA = await seedUser(teamA.id, 'Ada', 'ada@example.com');
      const userB = await seedUser(teamB.id, 'Zoe', 'zoe@example.com');
      await db.prisma.activityDailySummary.create({
        data: {
          userId: userA.id,
          day: new Date('2026-07-12T00:00:00.000Z'),
          avgActivityPct: 70,
          activeMinutes: 60,
          byApp: {},
          byCategory: { PRODUCTIVE: 60 },
        },
      });
      await db.prisma.activityDailySummary.create({
        data: {
          userId: userB.id,
          day: new Date('2026-07-12T00:00:00.000Z'),
          avgActivityPct: 70,
          activeMinutes: 60,
          byApp: {},
          byCategory: { PRODUCTIVE: 60 },
        },
      });
      await seedIdle(
        userB.id,
        '019797a0-0000-7000-8000-000000000302',
        '2026-07-12T12:00:00.000Z',
        '2026-07-12T12:10:00.000Z',
      );

      const rows = await repo().teamActivity(
        { kind: 'team', teamId: teamA.id },
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-07-31T00:00:00.000Z'),
      );

      expect(rows.map((r) => r.userId)).toEqual([userA.id]);
      expect(rows.map((r) => r.name)).toEqual(['Ada']);
    });
  });

  describe('app-usage', () => {
    let sampleSeq = 0;
    async function seedSample(
      userId: string,
      appName: string,
      category: 'PRODUCTIVE' | 'NEUTRAL' | 'UNPRODUCTIVE',
      ts: string,
    ) {
      await db.prisma.activitySample.create({
        data: {
          id: `019797a0-0000-7000-8000-0000000004${String(sampleSeq++).padStart(2, '0')}`,
          userId,
          timestamp: new Date(ts),
          appName,
          windowTitle: null,
          activityPct: 50,
          category,
        },
      });
    }

    it('ranks apps by total seconds and picks the dominant category', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      // Code: 3 samples (2 PRODUCTIVE, 1 UNPRODUCTIVE) -> 180s, dominant PRODUCTIVE
      await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
      await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:01:00.000Z');
      await seedSample(user.id, 'Code', 'UNPRODUCTIVE', '2026-07-12T09:02:00.000Z');
      // Slack: 1 sample NEUTRAL -> 60s
      await seedSample(user.id, 'Slack', 'NEUTRAL', '2026-07-12T09:03:00.000Z');

      const rows = await repo().appUsage(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        10,
      );

      expect(rows).toEqual([
        { appName: 'Code', seconds: 180, category: 'PRODUCTIVE' },
        { appName: 'Slack', seconds: 60, category: 'NEUTRAL' },
      ]);
    });

    it('honors the limit', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
      await seedSample(user.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:01:00.000Z');
      await seedSample(user.id, 'Slack', 'NEUTRAL', '2026-07-12T09:02:00.000Z');
      const rows = await repo().appUsage(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        1,
      );
      expect(rows).toEqual([{ appName: 'Code', seconds: 120, category: 'PRODUCTIVE' }]);
    });

    it('isolates teams: scoping to team A excludes team B app samples', async () => {
      const teamA = await seedTeam();
      const teamB = await seedTeam();
      const userA = await seedUser(teamA.id, 'Ada', 'ada@example.com');
      const userB = await seedUser(teamB.id, 'Zoe', 'zoe@example.com');
      await seedSample(userA.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
      await seedSample(userB.id, 'Slack', 'NEUTRAL', '2026-07-12T09:00:00.000Z');

      const rows = await repo().appUsage(
        { kind: 'team', teamId: teamA.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        10,
      );

      expect(rows).toEqual([{ appName: 'Code', seconds: 60, category: 'PRODUCTIVE' }]);
    });

    it('breaks a dominant-category tie by UNPRODUCTIVE > NEUTRAL > PRODUCTIVE', async () => {
      const team = await seedTeam();
      const user = await seedUser(team.id, 'Ada', 'ada@example.com');
      // Equal 60s in each of the three categories on the same app — the tie-break must
      // pick UNPRODUCTIVE over NEUTRAL over PRODUCTIVE, not just "the last one grouped."
      await seedSample(user.id, 'Browser', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
      await seedSample(user.id, 'Browser', 'NEUTRAL', '2026-07-12T09:01:00.000Z');
      await seedSample(user.id, 'Browser', 'UNPRODUCTIVE', '2026-07-12T09:02:00.000Z');

      const rows = await repo().appUsage(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        10,
      );

      expect(rows).toEqual([{ appName: 'Browser', seconds: 180, category: 'UNPRODUCTIVE' }]);
    });

    it('aggregates two users of the same team into one app total', async () => {
      const team = await seedTeam();
      const ada = await seedUser(team.id, 'Ada', 'ada@example.com');
      const bea = await seedUser(team.id, 'Bea', 'bea@example.com');
      await seedSample(ada.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');
      await seedSample(bea.id, 'Code', 'PRODUCTIVE', '2026-07-12T09:00:00.000Z');

      const rows = await repo().appUsage(
        { kind: 'team', teamId: team.id },
        new Date('2026-07-12T00:00:00.000Z'),
        new Date('2026-07-13T00:00:00.000Z'),
        10,
      );

      expect(rows).toEqual([{ appName: 'Code', seconds: 120, category: 'PRODUCTIVE' }]);
    });
  });
});

describe.runIf(RUN_E2E)('reports repository — teamSummary (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-07-08T00:00:00.000Z');
  const FRESHNESS = 300; // freshnessSeconds for these assertions

  function repo(): ReportsRepository {
    return new ReportsRepository(db.prisma as unknown as PrismaService);
  }
  async function team() {
    return db.prisma.team.create({ data: { name: 'Eng', settings: {} }, select: { id: true } });
  }
  async function user(teamId: string, name: string, email: string) {
    return db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  }
  async function entry(userId: string, id: string, startIso: string, endIso: string) {
    await db.prisma.timeEntry.create({
      data: {
        id,
        userId,
        source: 'MANUAL',
        startTime: new Date(startIso),
        endTime: new Date(endIso),
      },
    });
  }
  /** A STRANDED open entry: started, never stopped, client no longer heartbeating. */
  async function strandedEntry(
    userId: string,
    id: string,
    startIso: string,
    heartbeatIso: string | null,
  ) {
    await db.prisma.timeEntry.create({
      data: {
        id,
        userId,
        source: 'MANUAL',
        startTime: new Date(startIso),
        endTime: null,
        heartbeatAt: heartbeatIso === null ? null : new Date(heartbeatIso),
      },
    });
  }
  async function summary(
    userId: string,
    day: string,
    avgActivityPct: number,
    activeMinutes: number,
  ) {
    await db.prisma.activityDailySummary.create({
      data: {
        userId,
        day: new Date(day),
        avgActivityPct,
        activeMinutes,
        byApp: {},
        byCategory: {},
      },
    });
  }

  it('does NOT fan out: multiple entries AND multiple summary rows for one user', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    // 3 entries: 60 + 60 + 30 = 150 min = 9000 s
    await entry(
      u.id,
      '019797a0-0000-7000-8000-000000000201',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );
    await entry(
      u.id,
      '019797a0-0000-7000-8000-000000000202',
      '2026-07-03T09:00:00Z',
      '2026-07-03T10:00:00Z',
    );
    await entry(
      u.id,
      '019797a0-0000-7000-8000-000000000203',
      '2026-07-04T09:00:00Z',
      '2026-07-04T09:30:00Z',
    );
    // 2 summaries: weighted avg = (80*100 + 40*300) / (100+300) = (8000+12000)/400 = 50
    await summary(u.id, '2026-07-02', 80, 100);
    await summary(u.id, '2026-07-03', 40, 300);

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows).toEqual([{ userId: u.id, name: 'Ada', trackedSeconds: 9000, activityPct: 50 }]);
  });

  it('tracked time but no activity rows yields activityPct 0 (contract-safe)', async () => {
    const t = await team();
    const u = await user(t.id, 'Bea', 'bea@example.com');
    await entry(
      u.id,
      '019797a0-0000-7000-8000-000000000204',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows).toEqual([{ userId: u.id, name: 'Bea', trackedSeconds: 3600, activityPct: 0 }]);
  });

  it('includes a deactivated user who has data in the range', async () => {
    const t = await team();
    const gone = await db.prisma.user.create({
      data: {
        email: 'cara@example.com',
        name: 'Cara',
        passwordHash: 'x',
        teamId: t.id,
        deactivatedAt: new Date(),
      },
      select: { id: true },
    });
    await entry(
      gone.id,
      '019797a0-0000-7000-8000-000000000205',
      '2026-07-02T09:00:00Z',
      '2026-07-02T09:30:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows.map((r) => r.name)).toEqual(['Cara']);
    expect(rows[0]?.trackedSeconds).toBe(1800);
  });

  it('clamps an entry crossing the range boundary', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    // starts 1h before FROM, ends 1h into range → only the in-range hour counts
    await entry(
      u.id,
      '019797a0-0000-7000-8000-000000000206',
      '2026-06-30T23:00:00Z',
      '2026-07-01T01:00:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows[0]?.trackedSeconds).toBe(3600);
  });

  it('an open entry with a stale heartbeat stops accruing trackedSeconds', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: '01920000-0000-7000-8000-00000000fc04',
        userId: u.id,
        source: 'MANUAL',
        startTime: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago
        endTime: null,
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // stale, 1h ago
      },
    });

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, from, to, FRESHNESS);
    // 30 min start->heartbeat + 300s freshness = 2100s, not the ~5400s an unclamped now()
    // would give.
    expect(rows[0]?.trackedSeconds).toBeGreaterThanOrEqual(2000);
    expect(rows[0]?.trackedSeconds).toBeLessThanOrEqual(2200);
  });

  it('kind=user scopes to a single user; kind=all spans teams', async () => {
    const t1 = await team();
    const t2 = await team();
    const a = await user(t1.id, 'Ada', 'ada@example.com');
    const z = await user(t2.id, 'Zoe', 'zoe@example.com');
    await entry(
      a.id,
      '019797a0-0000-7000-8000-000000000207',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );
    await entry(
      z.id,
      '019797a0-0000-7000-8000-000000000208',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );

    const self = await repo().teamSummary({ kind: 'user', userId: a.id }, FROM, TO, FRESHNESS);
    expect(self.map((r) => r.name)).toEqual(['Ada']);

    const all = await repo().teamSummary({ kind: 'all' }, FROM, TO, FRESHNESS);
    expect(all.map((r) => r.name).sort()).toEqual(['Ada', 'Zoe']);
  });

  it('excludes a user with no data in the range (has-data-in-range predicate)', async () => {
    const t = await team();
    const a = await user(t.id, 'Ada', 'ada@example.com');
    const b = await user(t.id, 'Bea', 'bea@example.com');
    // Ada has an entry inside the range.
    await entry(
      a.id,
      '019797a0-0000-7000-8000-000000000209',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );
    // Bea has an entry entirely before FROM, and no activity summary at all.
    await entry(
      b.id,
      '019797a0-0000-7000-8000-000000000210',
      '2026-06-15T09:00:00Z',
      '2026-06-15T10:00:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
  });

  it('a zero-duration entry does not surface a phantom user row (has-data predicate)', async () => {
    const t = await team();
    const a = await user(t.id, 'Ada', 'ada@example.com');
    const b = await user(t.id, 'Bea', 'bea@example.com');
    // Ada has a real, in-range entry.
    await entry(
      a.id,
      '019797a0-0000-7000-8000-000000000211',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );
    // Bea's ONLY entry in range is a discarded recovery span (spec §4.4, Task 7's Discard
    // path): closed at its own start, and no activity summary at all.
    await entry(
      b.id,
      '019797a0-0000-7000-8000-000000000212',
      '2026-07-02T09:00:00Z',
      '2026-07-02T09:00:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    // Without the fix, Bea would appear as a phantom { trackedSeconds: 0, activityPct: 0 } row.
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
  });

  it('a stranded open entry from before the range does not surface a phantom user row', async () => {
    const t = await team();
    const a = await user(t.id, 'Ada', 'ada@example.com');
    const b = await user(t.id, 'Bea', 'bea@example.com');
    await entry(
      a.id,
      '019797a0-0000-7000-8000-000000000213',
      '2026-07-02T09:00:00Z',
      '2026-07-02T10:00:00Z',
    );
    // Bea's ONLY entry started well BEFORE the range and was never stopped, and she has no
    // activity summary. The row-selection predicate used to read `COALESCE(endTime, now()) >
    // from` — true for any open row, whenever it started — so Bea passed the has-data check,
    // then summed to 0 because the duration expression IS clamped. The result was a row saying
    // "Bea: 0% active", which is a different claim from "no data for Bea".
    await strandedEntry(
      b.id,
      '019797a0-0000-7000-8000-000000000214',
      '2026-06-15T09:00:00Z',
      '2026-06-15T09:03:00Z',
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
  });

  it('a LIVE open entry still surfaces its user (the critical property)', async () => {
    const t = await team();
    const b = await user(t.id, 'Bea', 'bea@example.com');
    // The counterpart of the test above: a timer running RIGHT NOW must still be reported, so
    // the clamped selection predicate can never be simplified to "closed entries only".
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await strandedEntry(
      b.id,
      '019797a0-0000-7000-8000-000000000215',
      new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    );

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, from, to, FRESHNESS);
    expect(rows.map((r) => r.name)).toEqual(['Bea']);
    expect(rows[0]!.trackedSeconds).toBeGreaterThan(0);
  });
});

describe.runIf(RUN_E2E)('reports repository — projects (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-07-08T00:00:00.000Z');
  const FRESHNESS = 300; // freshnessSeconds for these assertions
  function repo(): ReportsRepository {
    return new ReportsRepository(db.prisma as unknown as PrismaService);
  }

  it('groups by project and buckets null-project time under "No project"', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const p = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    // 1h on Acme, 30m with no project
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000301',
        userId: u.id,
        projectId: p.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000302',
        userId: u.id,
        projectId: null,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T11:00:00Z'),
        endTime: new Date('2026-07-02T11:30:00Z'),
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows).toEqual([
      { projectId: p.id, name: 'Acme', trackedSeconds: 3600 },
      { projectId: null, name: 'No project', trackedSeconds: 1800 },
    ]);
    // reconciles to the user's total tracked seconds (3600 + 1800)
    expect(rows.reduce((s, r) => s + r.trackedSeconds, 0)).toBe(5400);
  });

  it('a project whose only entry is stranded open does not surface a phantom project row', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const real = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    const ghost = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Ghost' },
      select: { id: true },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000311',
        userId: u.id,
        projectId: real.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });
    // Ghost's only entry started in JUNE and was never stopped. An unclamped
    // `COALESCE(endTime, now()) > from` selected it into this July range, where it summed to 0.
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000312',
        userId: u.id,
        projectId: ghost.id,
        source: 'MANUAL',
        startTime: new Date('2026-06-15T09:00:00Z'),
        endTime: null,
        heartbeatAt: new Date('2026-06-15T09:03:00Z'),
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows).toEqual([{ projectId: real.id, name: 'Acme', trackedSeconds: 3600 }]);
  });

  it('a project whose only entry is zero-duration does not surface a phantom project row', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const real = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    const discarded = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Ghost' },
      select: { id: true },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000303',
        userId: u.id,
        projectId: real.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });
    // "Ghost" project's ONLY entry in range is a discarded recovery span (spec §4.4,
    // Task 7's Discard path): closed at its own start.
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000304',
        userId: u.id,
        projectId: discarded.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T11:00:00Z'),
        endTime: new Date('2026-07-02T11:00:00Z'),
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    // Without the fix, "Ghost" would appear as a phantom { trackedSeconds: 0 } row.
    expect(rows).toEqual([{ projectId: real.id, name: 'Acme', trackedSeconds: 3600 }]);
  });

  it('an open entry with a stale heartbeat stops accruing trackedSeconds', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: '01920000-0000-7000-8000-00000000fc05',
        userId: u.id,
        projectId: null,
        source: 'MANUAL',
        startTime: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago
        endTime: null,
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // stale, 1h ago
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, from, to, FRESHNESS);
    // 30 min start->heartbeat + 300s freshness = 2100s, not the ~5400s an unclamped now()
    // would give.
    expect(rows[0]?.trackedSeconds).toBeGreaterThanOrEqual(2000);
    expect(rows[0]?.trackedSeconds).toBeLessThanOrEqual(2200);
  });

  it('honors an explicit projectId filter', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const p1 = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    const p2 = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Beta' },
      select: { id: true },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000303',
        userId: u.id,
        projectId: p1.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000304',
        userId: u.id,
        projectId: p2.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS, p1.id);
    expect(rows).toEqual([{ projectId: p1.id, name: 'Acme', trackedSeconds: 3600 }]);
  });

  it('breaks a trackedSeconds tie by projectId ASC (deterministic ordering)', async () => {
    const t = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const u = await db.prisma.user.create({
      data: { email: 'ada@example.com', name: 'Ada', passwordHash: 'x', teamId: t.id },
      select: { id: true },
    });
    const p1 = await db.prisma.project.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000a0a01',
        teamId: t.id,
        name: 'Alpha',
      },
      select: { id: true },
    });
    const p2 = await db.prisma.project.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000a0a02',
        teamId: t.id,
        name: 'Beta',
      },
      select: { id: true },
    });
    // Equal 1h (3600s) tracked on each project — same duration, different projectId.
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000305',
        userId: u.id,
        projectId: p1.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000306',
        userId: u.id,
        projectId: p2.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-02T09:00:00Z'),
        endTime: new Date('2026-07-02T10:00:00Z'),
      },
    });

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, FRESHNESS);
    expect(rows.every((r) => r.trackedSeconds === 3600)).toBe(true);
    // Ties on trackedSeconds break by projectId ASC — the smaller id sorts first.
    expect(rows.map((r) => r.projectId)).toEqual([p1.id, p2.id]);
  });
});

describe.runIf(RUN_E2E)('reports repository — streamEntries (real Postgres)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await startTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  afterEach(async () => {
    await truncateAll(db.prisma);
  });

  const FROM = new Date('2026-07-01T00:00:00.000Z');
  const TO = new Date('2026-07-08T00:00:00.000Z');
  const FRESHNESS = 300; // freshnessSeconds for these assertions
  function repo(): ReportsRepository {
    return new ReportsRepository(db.prisma as unknown as PrismaService);
  }
  async function collect(
    scope: Parameters<ReportsRepository['streamEntries']>[0],
    projectId?: string,
    batchSize?: number,
  ) {
    const out: Array<Record<string, unknown>> = [];
    for await (const row of repo().streamEntries(
      scope,
      FROM,
      TO,
      FRESHNESS,
      projectId,
      batchSize,
    )) {
      out.push(row);
    }
    return out;
  }
  async function team() {
    return db.prisma.team.create({ data: { name: 'Eng', settings: {} }, select: { id: true } });
  }
  async function user(teamId: string, name: string, email: string) {
    return db.prisma.user.create({
      data: { email, name, passwordHash: 'x', teamId },
      select: { id: true },
    });
  }

  it('yields nothing for an empty set', async () => {
    const t = await team();
    await user(t.id, 'Ada', 'ada@example.com');
    expect(await collect({ kind: 'team', teamId: t.id })).toEqual([]);
  });

  it('omits a stranded open entry that ended before the range began', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    // Started in June, never stopped. The row-selection predicate used to read
    // `COALESCE(endTime, now()) > from`, true for ANY open row whenever it started, so this
    // entry landed in the CSV export of an unrelated July range as a 0-second line.
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000004a1',
        userId: u.id,
        source: 'MANUAL',
        startTime: new Date('2026-06-15T09:00:00Z'),
        endTime: null,
        heartbeatAt: new Date('2026-06-15T09:03:00Z'),
      },
    });

    expect(await collect({ kind: 'team', teamId: t.id })).toEqual([]);
  });

  it('joins user/project/task names and clamps a boundary-crossing entry', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const p = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    const tk = await db.prisma.task.create({
      data: { projectId: p.id, name: 'Build' },
      select: { id: true },
    });
    // starts 1h before FROM, ends 1h into range → clamped to [FROM, FROM+1h], 3600s.
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000401',
        userId: u.id,
        projectId: p.id,
        taskId: tk.id,
        source: 'MANUAL',
        startTime: new Date('2026-06-30T23:00:00Z'),
        endTime: new Date('2026-07-01T01:00:00Z'),
      },
    });
    const rows = await collect({ kind: 'team', teamId: t.id });
    expect(rows).toEqual([
      {
        entryId: '019797a0-0000-7000-8000-000000000401',
        user: 'Ada',
        project: 'Acme',
        task: 'Build',
        startTime: new Date('2026-07-01T00:00:00.000Z'), // clamped to FROM
        endTime: new Date('2026-07-01T01:00:00.000Z'),
        durationSeconds: 3600,
        source: 'MANUAL',
        note: null,
      },
    ]);
    // clamp invariant: end - start == durationSeconds
    const r = rows[0]!;
    expect(((r.endTime as Date).getTime() - (r.startTime as Date).getTime()) / 1000).toBe(
      r.durationSeconds,
    );
  });

  it('renders a running entry with a null endTime clamped to now()', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000402',
        userId: u.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 60_000),
        endTime: null,
      },
    });
    const out: Array<Record<string, unknown>> = [];
    for await (const row of repo().streamEntries(
      { kind: 'team', teamId: t.id },
      from,
      to,
      FRESHNESS,
    )) {
      out.push(row);
    }
    expect(out).toHaveLength(1);
    expect(out[0]!.endTime).toBeNull();
    expect(out[0]!.durationSeconds as number).toBeGreaterThanOrEqual(59);
    expect(out[0]!.durationSeconds as number).toBeLessThan(120);
  });

  it('clamps an open entry with a stale heartbeat, but leaves endTime null', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000403',
        userId: u.id,
        source: 'AUTO',
        startTime: new Date(Date.now() - 90 * 60 * 1000), // 90 min ago
        endTime: null,
        heartbeatAt: new Date(Date.now() - 60 * 60 * 1000), // stale, 1h ago
      },
    });
    const out: Array<Record<string, unknown>> = [];
    for await (const row of repo().streamEntries(
      { kind: 'team', teamId: t.id },
      from,
      to,
      FRESHNESS,
    )) {
      out.push(row);
    }
    expect(out).toHaveLength(1);
    // the projection still shows an open entry's end as blank, never a synthesised clamp
    expect(out[0]!.endTime).toBeNull();
    // duration is clamped to heartbeat + freshness (30min + 300s = 2100s), not the ~5400s
    // it would be if bounded by now().
    expect(out[0]!.durationSeconds as number).toBeGreaterThanOrEqual(2000);
    expect(out[0]!.durationSeconds as number).toBeLessThanOrEqual(2200);
  });

  it('applies the projectId filter', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const p1 = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Acme' },
      select: { id: true },
    });
    const p2 = await db.prisma.project.create({
      data: { teamId: t.id, name: 'Beta' },
      select: { id: true },
    });
    for (const [i, pid] of [p1.id, p2.id].entries()) {
      await db.prisma.timeEntry.create({
        data: {
          id: `019797a0-0000-7000-8000-00000000041${i}`,
          userId: u.id,
          projectId: pid,
          source: 'MANUAL',
          startTime: new Date('2026-07-02T09:00:00Z'),
          endTime: new Date('2026-07-02T10:00:00Z'),
        },
      });
    }
    const rows = await collect({ kind: 'team', teamId: t.id }, p1.id);
    expect(rows.map((r) => r.project)).toEqual(['Acme']);
  });

  it('paginates across batches in (startTime, id) order without dropping or duplicating', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    // 5 entries, distinct start times; batchSize 2 forces 3 pages (2 + 2 + 1).
    for (let i = 0; i < 5; i++) {
      await db.prisma.timeEntry.create({
        data: {
          id: `019797a0-0000-7000-8000-0000000004${20 + i}`,
          userId: u.id,
          source: 'MANUAL',
          startTime: new Date(`2026-07-02T0${i}:00:00Z`),
          endTime: new Date(`2026-07-02T0${i}:30:00Z`),
        },
      });
    }
    const rows = await collect({ kind: 'team', teamId: t.id }, undefined, 2);
    expect(rows).toHaveLength(5);
    // ascending by startTime → the seeded 00:00..04:00 order
    expect(rows.map((r) => (r.startTime as Date).toISOString())).toEqual([
      '2026-07-02T00:00:00.000Z',
      '2026-07-02T01:00:00.000Z',
      '2026-07-02T02:00:00.000Z',
      '2026-07-02T03:00:00.000Z',
      '2026-07-02T04:00:00.000Z',
    ]);
    // no duplicates across the batch boundary
    expect(new Set(rows.map((r) => r.entryId)).size).toBe(5);
  });

  it('scopes kind=user to a single user and kind=all across teams', async () => {
    const t1 = await team();
    const t2 = await team();
    const a = await user(t1.id, 'Ada', 'ada@example.com');
    const z = await user(t2.id, 'Zoe', 'zoe@example.com');
    for (const [i, uid] of [a.id, z.id].entries()) {
      await db.prisma.timeEntry.create({
        data: {
          id: `019797a0-0000-7000-8000-00000000043${i}`,
          userId: uid,
          source: 'MANUAL',
          startTime: new Date('2026-07-02T09:00:00Z'),
          endTime: new Date('2026-07-02T10:00:00Z'),
        },
      });
    }
    expect((await collect({ kind: 'user', userId: a.id })).map((r) => r.user)).toEqual(['Ada']);
    expect((await collect({ kind: 'all' })).map((r) => r.user).sort()).toEqual(['Ada', 'Zoe']);
  });

  it('truncates a sub-second `to` boundary clamp so the row self-reconciles', async () => {
    // Real trigger: the dashboard range picker sends `to` at end-of-day with milliseconds
    // (…T23:59:59.999Z). An entry clamped to that boundary must still satisfy
    // end - start == durationSeconds — sub-second endTime with a floored duration breaks it.
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const TO_MS = new Date('2026-07-08T23:59:59.999Z');
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000440',
        userId: u.id,
        source: 'MANUAL',
        startTime: new Date('2026-07-08T23:00:00.000Z'),
        endTime: new Date('2026-07-09T02:00:00.000Z'), // crosses TO_MS
      },
    });
    const out: Array<Record<string, unknown>> = [];
    for await (const row of repo().streamEntries(
      { kind: 'team', teamId: t.id },
      FROM,
      TO_MS,
      FRESHNESS,
    )) {
      out.push(row);
    }
    expect(out).toHaveLength(1);
    const r = out[0]!;
    // clamped to whole seconds — not the sub-second `.999` boundary
    expect((r.endTime as Date).getMilliseconds()).toBe(0);
    // row self-reconciles: end - start == durationSeconds, unconditionally
    expect(((r.endTime as Date).getTime() - (r.startTime as Date).getTime()) / 1000).toBe(
      r.durationSeconds,
    );
  });

  it('excludes a zero-duration (discarded recovery) entry but keeps an open entry alongside it', async () => {
    const t = await team();
    const u = await user(t.id, 'Ada', 'ada@example.com');
    const at = new Date('2026-07-02T09:00:00.000Z');
    // A discarded recovery span: closed at its own start (spec §4.4, Task 7's Discard path).
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000450',
        userId: u.id,
        source: 'MANUAL',
        startTime: at,
        endTime: at,
      },
    });
    // A genuinely open entry in the same window — must still appear (spec's whole point).
    await db.prisma.timeEntry.create({
      data: {
        id: '019797a0-0000-7000-8000-000000000451',
        userId: u.id,
        source: 'AUTO',
        startTime: new Date('2026-07-02T10:00:00.000Z'),
        endTime: null,
      },
    });
    const ids = (await collect({ kind: 'team', teamId: t.id })).map((r) => r.entryId);
    expect(ids).not.toContain('019797a0-0000-7000-8000-000000000450');
    expect(ids).toContain('019797a0-0000-7000-8000-000000000451');
  });
});
