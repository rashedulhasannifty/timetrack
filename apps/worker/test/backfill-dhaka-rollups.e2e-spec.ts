import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { rebuildDhakaRollups } from '../src/processors/rollup-backfill.js';

const RUN_E2E = process.env.RUN_E2E === '1';

/**
 * The Dhaka backfill's delete rule is data-DESTRUCTIVE, so both halves are pinned here:
 * the double-count it must eliminate, and the unrebuildable rows it must NOT touch.
 *
 * Its own spec file rather than a block inside rollup-daily.e2e-spec.ts: the backfill scans
 * activity_samples globally with no user filter, so another suite's leftovers would move the
 * global first day and perturb every assertion.
 *
 * All sample timestamps sit in 2026-08 — activity_samples is monthly-partitioned and the
 * migrations seed 2026-07..2026-12.
 */
describe.runIf(RUN_E2E)('backfill-dhaka-rollups — real Postgres', () => {
  let env: WorkerTestEnv;

  // A Dhaka day AFTER every seeded day, so `lastDay` = 2026-08-20 in every case below.
  const NOW = new Date('2026-08-21T06:00:00.000Z'); // 12:00 Dhaka on 2026-08-21

  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });
  afterEach(async () => {
    await env.prisma.activityDailySummary.deleteMany({});
    await env.prisma.activitySample.deleteMany({});
    await env.prisma.user.deleteMany({});
    await env.prisma.team.deleteMany({});
  });

  async function seedUser(email: string) {
    const team = await env.prisma.team.create({
      data: { name: 'Eng', settings: {} },
      select: { id: true },
    });
    return env.prisma.user.create({
      data: { email, name: 'U', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
  }

  async function sample(userId: string, timestamp: string) {
    await env.prisma.activitySample.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        timestamp: new Date(timestamp),
        appName: 'Xcode',
        windowTitle: null,
        activityPct: 60,
        category: 'NEUTRAL',
      },
    });
  }

  /** A row exactly as the OLD, UTC-bucketed rollup would have written it. */
  async function staleUtcRow(userId: string, day: string, activeMinutes: number) {
    await env.prisma.activityDailySummary.create({
      data: {
        userId,
        day: new Date(`${day}T00:00:00.000Z`),
        avgActivityPct: 60,
        activeMinutes,
        byApp: { Xcode: activeMinutes },
        byCategory: { NEUTRAL: activeMinutes },
      },
    });
  }

  async function daysFor(userId: string): Promise<{ day: string; activeMinutes: number }[]> {
    const rows = await env.prisma.activityDailySummary.findMany({
      where: { userId },
      orderBy: { day: 'asc' },
    });
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      activeMinutes: r.activeMinutes,
    }));
  }

  it('removes the phantom row when a night shift moves to the next Dhaka day', async () => {
    // FINDING 1's worked example, with earlier history so the user's own floor is well below
    // the day being rebuilt. 01:00-04:00 Dhaka on 2026-08-20 == 19:00-22:00Z on 2026-08-19,
    // which the old UTC rollup labelled 2026-08-19.
    const u = await seedUser('night@example.com');
    await sample(u.id, '2026-08-10T09:00:00.000Z'); // 15:00 Dhaka, 2026-08-10 — their floor
    await sample(u.id, '2026-08-19T19:00:00.000Z'); // 01:00 Dhaka, 2026-08-20
    await sample(u.id, '2026-08-19T20:00:00.000Z');
    await sample(u.id, '2026-08-19T21:00:00.000Z');
    await sample(u.id, '2026-08-19T22:00:00.000Z');
    await staleUtcRow(u.id, '2026-08-10', 1);
    await staleUtcRow(u.id, '2026-08-19', 4); // the row that must not survive

    const report = await rebuildDhakaRollups(env.prisma, NOW);

    // The 2026-08-19 Dhaka window ([08-18T18:00Z, 08-19T18:00Z)) is WHOLLY EMPTY, which is
    // exactly the case an early `continue` would skip — the delete pass still has to run.
    expect(await daysFor(u.id)).toEqual([
      { day: '2026-08-10', activeMinutes: 1 },
      { day: '2026-08-20', activeMinutes: 4 },
    ]);
    expect(report.deletedStaleRows).toBe(1);
  });

  it("preserves a row at or below the user's own sample floor (samples already purged)", async () => {
    // `purged` holds a 2026-08-12 summary whose samples retention already removed. Another
    // team's user keeps the GLOBAL floor low, so the loop does walk 2026-08-12 — the only
    // thing stopping the delete is the per-user floor.
    const other = await seedUser('longretention@example.com');
    await sample(other.id, '2026-08-10T09:00:00.000Z');

    const purged = await seedUser('purged@example.com');
    await sample(purged.id, '2026-08-19T09:00:00.000Z'); // 15:00 Dhaka, 2026-08-19 — their floor
    await staleUtcRow(purged.id, '2026-08-12', 300); // unrebuildable: no samples left for it

    // A user with summary rows and NO surviving samples at all is likewise untouchable.
    const gone = await seedUser('gone@example.com');
    await staleUtcRow(gone.id, '2026-08-11', 120);

    const report = await rebuildDhakaRollups(env.prisma, NOW);

    expect(await daysFor(purged.id)).toEqual([
      { day: '2026-08-12', activeMinutes: 300 }, // preserved, untouched
      { day: '2026-08-19', activeMinutes: 1 }, // rebuilt from the surviving sample
    ]);
    expect(await daysFor(gone.id)).toEqual([{ day: '2026-08-11', activeMinutes: 120 }]);
    expect(report.deletedStaleRows).toBe(0);
    expect(report.unrebuildableUserIds).toEqual([gone.id]);
    expect(report.users.find((u) => u.userId === purged.id)?.alignedFrom).toBe('2026-08-20');
  });

  it('DOCUMENTED GAP: a night worker with no earlier history keeps both labels', async () => {
    // FINDING 1's example taken literally — "and has no other activity". The user's oldest
    // SURVIVING sample is 2026-08-19T19:00Z, whose Dhaka day is 2026-08-20, so their floor day
    // is NOT strictly earlier than 2026-08-19 and no delete fires. The floor cannot tell
    // "purged" from "never had any", and erring the other way would destroy unrebuildable rows.
    const other = await seedUser('longretention@example.com');
    await sample(other.id, '2026-08-10T09:00:00.000Z'); // keeps 2026-08-19 inside the walked range

    const u = await seedUser('night@example.com');
    await sample(u.id, '2026-08-19T19:00:00.000Z');
    await sample(u.id, '2026-08-19T20:00:00.000Z');
    await sample(u.id, '2026-08-19T21:00:00.000Z');
    await sample(u.id, '2026-08-19T22:00:00.000Z');
    await staleUtcRow(u.id, '2026-08-19', 4);

    await rebuildDhakaRollups(env.prisma, NOW);

    // Both labels survive. Asserted so the gap is visible and a future fix breaks this test.
    expect(await daysFor(u.id)).toEqual([
      { day: '2026-08-19', activeMinutes: 4 },
      { day: '2026-08-20', activeMinutes: 4 },
    ]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const u = await seedUser('night@example.com');
    await sample(u.id, '2026-08-10T09:00:00.000Z');
    await sample(u.id, '2026-08-19T19:00:00.000Z');
    await staleUtcRow(u.id, '2026-08-19', 1);

    await rebuildDhakaRollups(env.prisma, NOW);
    const afterFirst = await daysFor(u.id);
    const second = await rebuildDhakaRollups(env.prisma, NOW);

    expect(await daysFor(u.id)).toEqual(afterFirst);
    expect(second.deletedStaleRows).toBe(0);
  });

  it('reports no range when there are no samples at all', async () => {
    const report = await rebuildDhakaRollups(env.prisma, NOW);
    expect(report.firstDay).toBeNull();
    expect(report.lastDay).toBeNull();
    expect(report.daysWalked).toBe(0);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('backfill-dhaka-rollups harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
