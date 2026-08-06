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

  it('ingests and reads back an optional bundleId (present and absent)', async () => {
    const u = await seedUser('b1@example.com');
    const accepted = await repo().insertBatch(u.id, [
      {
        id: '019797a0-0000-7000-8000-0000000000d1',
        timestamp: '2026-07-11T09:00:00.000Z',
        appName: 'Code',
        bundleId: 'com.microsoft.VSCode',
        windowTitle: null,
        activityPct: 50,
        category: 'NEUTRAL',
      },
      {
        // No bundleId — mirrors the shipped client that omits it.
        id: '019797a0-0000-7000-8000-0000000000d2',
        timestamp: '2026-07-11T09:01:00.000Z',
        appName: 'loginwindow',
        windowTitle: null,
        activityPct: 10,
        category: 'NEUTRAL',
      },
    ]);
    expect(accepted).toBe(2);

    const rows = await repo().list({
      userId: u.id,
      from: '2026-07-11T00:00:00.000Z',
      to: '2026-07-11T23:59:59.999Z',
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('019797a0-0000-7000-8000-0000000000d1')?.bundleId).toBe('com.microsoft.VSCode');
    expect(byId.get('019797a0-0000-7000-8000-0000000000d2')?.bundleId).toBeNull();
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('activity e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
