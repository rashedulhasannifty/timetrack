import { describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { Logger } from 'nestjs-pino';
import type { Queue } from 'bullmq';
import { RetentionScheduler } from './retention.scheduler.js';

describe('RetentionScheduler', () => {
  it('upserts nightly retention + partition-provision schedulers on bootstrap', async () => {
    const retentionUpsert = vi.fn().mockResolvedValue(undefined);
    const provisionUpsert = vi.fn().mockResolvedValue(undefined);
    const retentionQ = { upsertJobScheduler: retentionUpsert } as unknown as Queue;
    const provisionQ = { upsertJobScheduler: provisionUpsert } as unknown as Queue;
    const logger = { log: () => {} } as unknown as Logger;

    await new RetentionScheduler(retentionQ, provisionQ, logger).onApplicationBootstrap();

    expect(retentionUpsert).toHaveBeenCalledWith(
      'retention-cron',
      { pattern: '20 3 * * *', tz: 'UTC' },
      { name: 'retention', data: {} },
    );
    expect(provisionUpsert).toHaveBeenCalledWith(
      'partition-provision-cron',
      { pattern: '10 3 * * *', tz: 'UTC' },
      { name: 'partition-provision', data: {} },
    );
  });
});
