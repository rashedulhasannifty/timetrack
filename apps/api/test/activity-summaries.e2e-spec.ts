import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/modules/activity/activity.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('activity summary repository read — real Postgres', () => {
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

  async function seedUser(email: string) {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    return db.prisma.user.create({
      data: { email, name: 'U', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
  }

  async function summary(userId: string, day: string, avgActivityPct: number) {
    await db.prisma.activityDailySummary.create({
      data: {
        userId,
        day: new Date(day),
        avgActivityPct,
        activeMinutes: 120,
        byApp: { Xcode: 90, Slack: 30 },
        byCategory: { NEUTRAL: 120 },
      },
    });
  }

  function repo(): ActivityRepository {
    return new ActivityRepository(db.prisma as unknown as PrismaService);
  }

  it('returns only the target user rows inside [from, to], ordered by day, day as YYYY-MM-DD', async () => {
    const u1 = await seedUser('s1@example.com');
    const u2 = await seedUser('s2@example.com');
    await summary(u1.id, '2026-07-12', 70);
    await summary(u1.id, '2026-07-11', 40);
    await summary(u1.id, '2026-07-20', 99); // out of window
    await summary(u2.id, '2026-07-11', 10); // other user

    const rows = await repo().listSummaries({
      userId: u1.id,
      from: '2026-07-11',
      to: '2026-07-12',
    });

    expect(rows.map((r) => r.avgActivityPct)).toEqual([40, 70]); // ordered, windowed, own-only
    expect(rows[0].day).toBe('2026-07-11');
    expect(rows[0].byApp).toEqual({ Xcode: 90, Slack: 30 });
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('activity summaries e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
