import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { TimesheetScheduler } from './timesheet.scheduler.js';

describe('TimesheetScheduler', () => {
  it('upserts a Monday 00:30 UTC job scheduler on bootstrap', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const logger = { log: () => {} } as unknown as Logger;

    await new TimesheetScheduler(queue, logger).onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'timesheet-generate-cron',
      { pattern: '30 0 * * 1', tz: 'UTC' },
      { name: 'timesheet-generate', data: {} },
    );
  });
});
