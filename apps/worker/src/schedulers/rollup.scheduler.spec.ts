import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { RollupScheduler } from './rollup.scheduler.js';

describe('RollupScheduler', () => {
  it('upserts a daily 00:15 UTC job scheduler on bootstrap', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const logger = { log: () => {} } as unknown as Logger;

    await new RollupScheduler(queue, logger).onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'rollup-daily-cron',
      { pattern: '15 0 * * *', tz: 'UTC' },
      { name: 'rollup', data: {} },
    );
  });
});
