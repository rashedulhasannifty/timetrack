import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { SYSTEM_ACTOR_ID } from '@timetrack/contracts';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { WorkerPrisma } from '../src/infra/prisma.provider.js';
import { WorkerS3 } from '../src/infra/s3.provider.js';
import { RetentionCleanupProcessor } from '../src/processors/retention-cleanup.processor.js';
import { partitionBounds } from '../src/processors/retention.util.js';

const RUN_E2E = process.env.RUN_E2E === '1';

async function ensureBucket(): Promise<void> {
  const c = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  try {
    await c.send(new HeadBucketCommand({ Bucket: 'timetrack-test' }));
  } catch {
    await c.send(new CreateBucketCommand({ Bucket: 'timetrack-test' }));
  }
}

describe.runIf(RUN_E2E)('retention-cleanup processor — real Postgres + MinIO', () => {
  let env: WorkerTestEnv;
  let s3: WorkerS3;
  const logger = { log: () => {} } as unknown as Logger;
  const NOW = '2026-07-20T03:20:00.000Z';
  const job = (s3impl: WorkerS3) => ({
    processor: new RetentionCleanupProcessor(env.prisma as unknown as WorkerPrisma, s3impl, logger),
  });
  const run = (proc: RetentionCleanupProcessor) =>
    proc.process({ data: { now: NOW } } as unknown as Job<{ now?: string }>);

  beforeAll(async () => {
    env = await startWorkerEnv();
    await ensureBucket();
    s3 = new WorkerS3(); // reads S3_* env the harness set
  });
  afterAll(async () => {
    await env.close();
  });

  async function makeTeam(retentionDays: number): Promise<string> {
    const team = await env.prisma.team.create({
      data: { name: `t${retentionDays}`, settings: { screenshotRetentionDays: retentionDays } },
      select: { id: true },
    });
    return team.id;
  }
  async function makeUser(teamId: string, email: string): Promise<string> {
    const u = await env.prisma.user.create({
      data: { email, name: 'U', passwordHash: 'x', teamId },
      select: { id: true },
    });
    return u.id;
  }
  // Insert a screenshot row + its raw object at a given timestamp.
  async function shot(userId: string, id: string, ts: string): Promise<string> {
    const key = `raw/${userId}/${id}`;
    await env.prisma.screenshot.create({
      data: {
        id,
        userId,
        timestamp: new Date(ts),
        storageKey: key,
        status: 'READY',
        blurred: false,
      },
    });
    await s3.putObject(key, Buffer.from('x'), 'image/png');
    return key;
  }
  const exists = async (key: string): Promise<boolean> => {
    try {
      await s3.getObject(key);
      return true;
    } catch {
      return false;
    }
  };
  const countShots = (userId: string) => env.prisma.screenshot.count({ where: { userId } });

  it('CENTERPIECE: two teams share a live partition at 7 vs 90 days — partition survives, short-retention rows go, long-retention rows stay, audit counts both', async () => {
    const t7 = await makeTeam(7);
    const t90 = await makeTeam(90);
    const u7 = await makeUser(t7, 'c-u7@x.com');
    const u90 = await makeUser(t90, 'c-u90@x.com');
    // July partition is live (NOW is 2026-07-20). Rows at 07-05 are 15 days old:
    //   > 7-day cutoff (deleted for t7), < 90-day cutoff (kept for t90).
    const gone = await shot(u7, '019797a0-0000-7000-8000-00000000c701', '2026-07-05T00:00:00Z');
    await shot(u90, '019797a0-0000-7000-8000-00000000c901', '2026-07-05T00:00:00Z');

    await run(job(s3).processor);

    // Partition still present (a live month, not past the 90-day max).
    const parts = await env.prisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
       JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='screenshots' AND c.relname='screenshots_2026_07'`,
    );
    expect(parts).toHaveLength(1);
    expect(await countShots(u7)).toBe(0); // t7 straggler deleted
    expect(await countShots(u90)).toBe(1); // t90 within retention
    expect(await exists(gone)).toBe(false); // its object deleted first

    const audit = await env.prisma.auditLog.findFirst({
      where: { action: 'retention.cleanup' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit?.actorId).toBe(SYSTEM_ACTOR_ID);
    const diff = audit?.diff as { screenshots: { deletedRows: number; deletedObjects: number } };
    expect(diff.screenshots.deletedRows).toBeGreaterThanOrEqual(1);
    expect(diff.screenshots.deletedObjects).toBeGreaterThanOrEqual(1);
  });

  it('DROP path: a partition entirely past the max retention is dropped and its objects deleted', async () => {
    // Synthesize an old partition — migrate deploy only creates 2026_07+, and you can't
    // insert into an unpartitioned range.
    await env.prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "screenshots_2025_12" PARTITION OF "screenshots"
       FOR VALUES FROM ('2025-12-01') TO ('2026-01-01')`,
    );
    const t = await makeTeam(30);
    const u = await makeUser(t, 'drop-u@x.com');
    const oldKey = await shot(u, '019797a0-0000-7000-8000-0000000dr001', '2025-12-15T00:00:00Z');

    // Sanity: bounds of the synthesized partition are well before NOW - 90d (max cutoff here is 90).
    expect(partitionBounds('screenshots_2025_12').to.getTime()).toBeLessThan(
      new Date('2026-04-21T00:00:00Z').getTime(),
    );

    await run(job(s3).processor);

    const still = await env.prisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
       JOIN pg_class p ON p.oid=i.inhparent WHERE c.relname='screenshots_2025_12'`,
    );
    expect(still).toHaveLength(0); // partition dropped
    expect(await exists(oldKey)).toBe(false); // object deleted first
  });

  it('ABORT: an S3 failure defers that unit — rows stay, audit records deferral; a healthy re-run completes it', async () => {
    const t7 = await makeTeam(7);
    const u = await makeUser(t7, 'abort-u@x.com');
    const key = await shot(u, '019797a0-0000-7000-8000-00000000ab01', '2026-07-01T00:00:00Z');

    const throwingS3 = {
      deleteObjects: () => Promise.reject(new Error('minio down')),
    } as unknown as WorkerS3;

    await run(
      new RetentionCleanupProcessor(env.prisma as unknown as WorkerPrisma, throwingS3, logger),
    );
    expect(await countShots(u)).toBe(1); // NOT deleted — S3 failed, unit deferred
    expect(await exists(key)).toBe(true);

    const deferred = await env.prisma.auditLog.findFirst({
      where: { action: 'retention.cleanup' },
      orderBy: { timestamp: 'desc' },
    });
    const d = deferred?.diff as { screenshots: { deferred: { reason: string }[] } };
    expect(d.screenshots.deferred.length).toBeGreaterThanOrEqual(1);

    // Healthy re-run finishes the job.
    await run(new RetentionCleanupProcessor(env.prisma as unknown as WorkerPrisma, s3, logger));
    expect(await countShots(u)).toBe(0);
    expect(await exists(key)).toBe(false);
  });

  it('keeps rows within retention untouched (no unbounded delete)', async () => {
    const t90 = await makeTeam(90);
    const u = await makeUser(t90, 'keep-u@x.com');
    await shot(u, '019797a0-0000-7000-8000-00000000ke01', '2026-07-19T00:00:00Z'); // 1 day old
    await run(job(s3).processor);
    expect(await countShots(u)).toBe(1);
  });
});

// Keeps the file a valid, non-empty suite when e2e is disabled.
describe('retention-cleanup harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
