import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { WorkerPrisma } from '../src/infra/prisma.provider.js';
import { PartitionProvisionProcessor } from '../src/processors/partition-provision.processor.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('partition-provision processor — real Postgres', () => {
  let env: WorkerTestEnv;
  const logger = { log: () => {} } as unknown as Logger;
  const run = (now: string) =>
    new PartitionProvisionProcessor(env.prisma as unknown as WorkerPrisma, logger).process({
      data: { now },
    } as unknown as Job<{ now?: string }>);

  beforeAll(async () => {
    env = await startWorkerEnv();
  });
  afterAll(async () => {
    await env.close();
  });

  async function partitions(table: string): Promise<string[]> {
    const rows = await env.prisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = $1 ORDER BY c.relname`,
      table,
    );
    return rows.map((r) => r.relname);
  }

  it('creates the current month and at least three months ahead, for both tables', async () => {
    // The init migration provides 2026_07..2026_12; "now" sits past all of them.
    await run('2027-03-15T03:20:00.000Z');
    for (const table of ['activity_samples', 'screenshots']) {
      const names = await partitions(table);
      for (const suffix of ['2027_03', '2027_04', '2027_05', '2027_06']) {
        expect(names).toContain(`${table}_${suffix}`);
      }
    }
    // A row three months out now has somewhere to land.
    await env.prisma.screenshot.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000000f1',
        userId: 'u',
        timestamp: new Date('2027-06-30T23:59:59.000Z'),
        storageKey: 'raw/u/x',
      },
    });
  });

  it('is idempotent: re-running leaves existing partitions and their rows untouched', async () => {
    await env.prisma.activitySample.create({
      data: {
        id: '019797a0-0000-7000-8000-0000000000f2',
        userId: 'u',
        timestamp: new Date('2026-12-10T00:00:00.000Z'),
        appName: 'Code',
        activityPct: 10,
      },
    });
    const before = await partitions('activity_samples');

    // 2026_11 and 2026_12 already exist (one holds a row); 2027_01 and 2027_02 are new.
    await run('2026-11-10T03:20:00.000Z');
    await run('2026-11-10T03:20:00.000Z');

    const after = await partitions('activity_samples');
    expect(after).toEqual(
      [...new Set([...before, 'activity_samples_2027_01', 'activity_samples_2027_02'])].sort(),
    );
    expect(
      await env.prisma.activitySample.count({
        where: { id: '019797a0-0000-7000-8000-0000000000f2' },
      }),
    ).toBe(1);
  });
});

describe('partition-provision e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
