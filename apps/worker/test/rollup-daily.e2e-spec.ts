import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Logger } from 'nestjs-pino';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { WorkerPrisma } from '../src/infra/prisma.provider.js';
import { RollupDailyProcessor } from '../src/processors/rollup-daily.processor.js';
import type { Job } from 'bullmq';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('rollup-daily processor — real Postgres', () => {
  let env: WorkerTestEnv;
  let processor: RollupDailyProcessor;

  beforeAll(async () => {
    env = await startWorkerEnv();
    const logger = { log: () => {} } as unknown as Logger;
    processor = new RollupDailyProcessor(env.prisma as unknown as WorkerPrisma, logger);
  });
  afterAll(async () => {
    await env.close();
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

  async function sample(
    userId: string,
    id: string,
    timestamp: string,
    appName: string,
    activityPct: number,
  ) {
    await env.prisma.activitySample.create({
      data: {
        id,
        userId,
        timestamp: new Date(timestamp),
        appName,
        windowTitle: null,
        activityPct,
        category: 'NEUTRAL',
      },
    });
  }

  const job = (day: string) => ({ data: { day } }) as unknown as Job<{ day?: string }>;

  it('rolls a day into one summary row per user; a re-run is idempotent', async () => {
    const u1 = await seedUser('r1@example.com');
    await sample(
      u1.id,
      '019797a0-0000-7000-8000-0000000000e1',
      '2026-07-11T09:00:00Z',
      'Xcode',
      40,
    );
    await sample(
      u1.id,
      '019797a0-0000-7000-8000-0000000000e2',
      '2026-07-11T10:00:00Z',
      'Xcode',
      80,
    );
    await sample(
      u1.id,
      '019797a0-0000-7000-8000-0000000000e3',
      '2026-07-12T00:00:00Z',
      'Slack',
      99,
    ); // next UTC day

    await processor.process(job('2026-07-11'));
    await processor.process(job('2026-07-11')); // idempotent re-run

    const rows = await env.prisma.activityDailySummary.findMany({ where: { userId: u1.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].avgActivityPct).toBe(60); // round((40+80)/2)
    expect(rows[0].activeMinutes).toBe(2); // 2 samples in-window
    expect(rows[0].byApp).toEqual({ Xcode: 2 }); // the 07-12 Slack sample excluded
    expect(rows[0].byCategory).toEqual({ NEUTRAL: 2 });
  });

  it('writes no rows for a day with no samples', async () => {
    await processor.process(job('2020-01-01'));
    const rows = await env.prisma.activityDailySummary.findMany({
      where: { day: new Date('2020-01-01') },
    });
    expect(rows).toHaveLength(0);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('rollup-daily harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
