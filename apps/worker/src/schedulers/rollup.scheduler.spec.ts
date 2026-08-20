import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { RollupScheduler } from './rollup.scheduler.js';

describe('RollupScheduler', () => {
  it('upserts a daily 00:15 Asia/Dhaka job scheduler on bootstrap', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const logger = { log: () => {} } as unknown as Logger;

    await new RollupScheduler(queue, logger).onApplicationBootstrap();

    // The tz must match the day boundary the rollup buckets on: a Dhaka day closes at
    // 18:00 UTC, so 'UTC' here would fire 6h15m after the day it rolls up has ended.
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'rollup-daily-cron',
      { pattern: '15 0 * * *', tz: 'Asia/Dhaka' },
      { name: 'rollup', data: {} },
    );
  });
});
