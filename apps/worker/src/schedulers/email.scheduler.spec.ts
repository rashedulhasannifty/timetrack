import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { EmailScheduler } from './email.scheduler.js';

describe('EmailScheduler', () => {
  it('upserts both weekly email schedulers on bootstrap, after timesheet-generate', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined);
    const queue = { upsertJobScheduler } as unknown as Queue;
    const logger = { log: () => {} } as unknown as Logger;

    await new EmailScheduler(queue, logger).onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'weekly-summary-cron',
      { pattern: '0 8 * * 1', tz: 'UTC' },
      { name: 'weekly-summary', data: {} },
    );
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'missing-timesheet-cron',
      { pattern: '0 9 * * 1', tz: 'UTC' },
      { name: 'missing-timesheet', data: {} },
    );
    // Both fall on Monday and both are later than timesheet-generate's 00:30 Mon, which
    // creates the PENDING rows the summary counts.
    for (const call of upsertJobScheduler.mock.calls) {
      const pattern = (call[1] as { pattern: string }).pattern;
      const [minute, hour, , , weekday] = pattern.split(' ');
      expect(weekday).toBe('1');
      expect(Number(hour) * 60 + Number(minute)).toBeGreaterThan(30);
    }
  });
});
