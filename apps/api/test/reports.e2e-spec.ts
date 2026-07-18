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

    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END);
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

    const [row] = await repo().overviewForTeam(team.id, dayStart, dayEnd);
    expect(row.tracking).toBe(true);
    expect(row.trackedSecondsToday).toBeGreaterThanOrEqual(59);
    expect(row.trackedSecondsToday).toBeLessThan(120);
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

    const [row] = await repo().overviewForTeam(team.id, DAY_START, DAY_END);
    expect(row.trackedSecondsToday).toBe(3600); // only the in-window hour
  });

  it('includes a zero-entry team member', async () => {
    const team = await seedTeam();
    const a = await seedUser(team.id, 'Ada', 'ada@example.com');
    const b = await seedUser(team.id, 'Bea', 'bea@example.com');
    void a;
    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END);
    const bea = rows.find((r) => r.name === 'Bea');
    expect(bea).toEqual({ userId: b.id, name: 'Bea', tracking: false, trackedSecondsToday: 0 });
  });

  it('overviewForSelf returns only that user', async () => {
    const team = await seedTeam();
    const a = await seedUser(team.id, 'Ada', 'ada@example.com');
    await seedUser(team.id, 'Bea', 'bea@example.com');
    const rows = await repo().overviewForSelf(a.id, DAY_START, DAY_END);
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

    const rows = await repo().overviewForTeam(team.id, DAY_START, DAY_END);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
    expect(rows).toEqual([
      { userId: active.id, name: 'Ada', tracking: false, trackedSecondsToday: 0 },
    ]);
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

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO);
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

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO);
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

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO);
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

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO);
    expect(rows[0]?.trackedSeconds).toBe(3600);
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

    const self = await repo().teamSummary({ kind: 'user', userId: a.id }, FROM, TO);
    expect(self.map((r) => r.name)).toEqual(['Ada']);

    const all = await repo().teamSummary({ kind: 'all' }, FROM, TO);
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

    const rows = await repo().teamSummary({ kind: 'team', teamId: t.id }, FROM, TO);
    expect(rows.map((r) => r.name)).toEqual(['Ada']);
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

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO);
    expect(rows).toEqual([
      { projectId: p.id, name: 'Acme', trackedSeconds: 3600 },
      { projectId: null, name: 'No project', trackedSeconds: 1800 },
    ]);
    // reconciles to the user's total tracked seconds (3600 + 1800)
    expect(rows.reduce((s, r) => s + r.trackedSeconds, 0)).toBe(5400);
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

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO, p1.id);
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

    const rows = await repo().projects({ kind: 'team', teamId: t.id }, FROM, TO);
    expect(rows.every((r) => r.trackedSeconds === 3600)).toBe(true);
    // Ties on trackedSeconds break by projectId ASC — the smaller id sorts first.
    expect(rows.map((r) => r.projectId)).toEqual([p1.id, p2.id]);
  });
});
