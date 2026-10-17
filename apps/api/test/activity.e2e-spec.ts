import './test-env.js'; // must run before anything that calls loadEnv()
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'nestjs-pino';
import { ActivityRepository } from '../src/modules/activity/activity.repository.js';
import { ActivityService } from '../src/modules/activity/activity.service.js';
import { PartitionRangeRepository } from '../src/common/partitions/partition-range.repository.js';
import { PartitionRangeService } from '../src/common/partitions/partition-range.service.js';
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

/**
 * A client whose clock runs months ahead, or an old offline queue holding samples from a month
 * retention already dropped, used to make the WHOLE batch fail with "no partition of relation
 * found" → 500 → the client never deletes the batch and re-sends it forever. The batch must now
 * succeed and store only the samples Postgres can hold.
 */
describe.runIf(RUN_E2E)('activity batch ingest — out-of-partition timestamps, real Postgres', () => {
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

  const DAY_MS = 86_400_000;

  function sample(id: string, timestamp: string) {
    return {
      id,
      timestamp,
      appName: 'Code',
      windowTitle: 'secret window title',
      activityPct: 50,
      category: 'NEUTRAL' as const,
    };
  }

  async function seedUser(email: string) {
    const team = await db.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    const user = await db.prisma.user.create({
      data: { email, name: 'P', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
    return { id: user.id, role: 'EMPLOYEE' as const, teamId: team.id };
  }

  function service(warn = vi.fn()): ActivityService {
    const prisma = db.prisma as unknown as PrismaService;
    return new ActivityService(
      new ActivityRepository(prisma),
      new PartitionRangeService(new PartitionRangeRepository(prisma)),
      { warn } as unknown as Logger,
    );
  }

  it('drops samples with no partition or a far-future clock, stores the rest, reports accepted', async () => {
    const user = await seedUser('p1@example.com');
    const warn = vi.fn();
    const inRange = '019797a0-0000-7000-8000-0000000000a1';

    const res = await service(warn).ingest(
      {
        samples: [
          // The init migration's oldest partition (2026_07).
          sample(inRange, '2026-07-11T09:00:00.000Z'),
          // Before the oldest partition — as if retention had already dropped that month.
          sample('019797a0-0000-7000-8000-0000000000a2', '2026-06-15T09:00:00.000Z'),
          // A clock years ahead — no partition at all.
          sample('019797a0-0000-7000-8000-0000000000a3', '2031-01-01T00:00:00.000Z'),
          // Days ahead of now: there may even be a partition, but no real sample is from the future.
          sample(
            '019797a0-0000-7000-8000-0000000000a4',
            new Date(Date.now() + 3 * DAY_MS).toISOString(),
          ),
        ],
      },
      user,
    );

    expect(res).toEqual({ accepted: 1 });
    const rows = await db.prisma.activitySample.findMany({ select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([inRange]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ userId: user.id, received: 4, dropped: 3 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret window title');
  });

  it('a batch where every sample is out of range succeeds with accepted 0', async () => {
    const user = await seedUser('p2@example.com');
    const res = await service().ingest(
      { samples: [sample('019797a0-0000-7000-8000-0000000000b1', '2031-01-01T00:00:00.000Z')] },
      user,
    );
    expect(res).toEqual({ accepted: 0 });
    expect(await db.prisma.activitySample.count()).toBe(0);
  });

  it('reads the real partition bounds from the catalog', async () => {
    const repo = new PartitionRangeRepository(db.prisma as unknown as PrismaService);
    expect(await repo.listPartitionBounds('activity_samples')).toContain(
      "FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00')",
    );
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('activity e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
