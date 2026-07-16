import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/modules/activity/activity.repository.js';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { startTestDb, truncateAll, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('activity repository read — real Postgres', () => {
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

  async function seedUser(email = 'a1@example.com') {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    return db.prisma.user.create({
      data: { email, name: 'A One', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
  }

  function repo(): ActivityRepository {
    return new ActivityRepository(db.prisma as unknown as PrismaService);
  }

  async function sample(userId: string, id: string, timestamp: string, activityPct = 50) {
    await db.prisma.activitySample.create({
      data: {
        id,
        userId,
        timestamp: new Date(timestamp),
        appName: 'Code',
        windowTitle: null,
        activityPct,
        category: 'NEUTRAL',
      },
    });
  }

  it('returns only the target user rows inside [from, to], ordered by timestamp', async () => {
    const u1 = await seedUser('a1@example.com');
    const u2 = await seedUser('a2@example.com');
    await sample(u1.id, '019797a0-0000-7000-8000-0000000000c2', '2026-07-11T10:00:00Z', 60);
    await sample(u1.id, '019797a0-0000-7000-8000-0000000000c1', '2026-07-11T09:00:00Z', 40);
    await sample(u1.id, '019797a0-0000-7000-8000-0000000000c3', '2026-07-12T00:00:01Z', 99); // out of window
    await sample(u2.id, '019797a0-0000-7000-8000-0000000000c4', '2026-07-11T09:30:00Z', 10); // other user

    const rows = await repo().list({
      userId: u1.id,
      from: '2026-07-11T00:00:00.000Z',
      to: '2026-07-11T23:59:59.999Z',
    });

    expect(rows.map((r) => r.activityPct)).toEqual([40, 60]); // ordered, windowed, own-only
    expect(rows[0].timestamp).toBe('2026-07-11T09:00:00.000Z');
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('activity e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
