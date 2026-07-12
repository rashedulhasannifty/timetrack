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
});
