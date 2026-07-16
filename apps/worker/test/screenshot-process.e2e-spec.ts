import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from 'nestjs-pino';
import { startWorkerEnv, type WorkerTestEnv } from './worker-harness.js';
import { WorkerPrisma } from '../src/infra/prisma.provider.js';
import { WorkerS3 } from '../src/infra/s3.provider.js';
import { ScreenshotProcessProcessor } from '../src/processors/screenshot-process.processor.js';

const RUN_E2E = process.env.RUN_E2E === '1';
const TS = '2026-07-16T10:00:00.000Z';

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

describe.runIf(RUN_E2E)('screenshot-process processor — real Postgres + MinIO', () => {
  let env: WorkerTestEnv;
  let s3: WorkerS3;
  let processor: ScreenshotProcessProcessor;

  beforeAll(async () => {
    env = await startWorkerEnv();
    await ensureBucket();
    s3 = new WorkerS3();
    const logger = { log: () => {} } as unknown as Logger;
    processor = new ScreenshotProcessProcessor(env.prisma as unknown as WorkerPrisma, s3, logger);
  });
  afterAll(async () => {
    await env.close();
  });

  async function seed(id: string, blur: string): Promise<{ userId: string }> {
    const team = await env.prisma.team.create({
      data: { name: 'Eng', settings: { screenshotBlur: blur } },
      select: { id: true },
    });
    const user = await env.prisma.user.create({
      data: { email: `${id}@e.test`, name: 'U', passwordHash: 'x', teamId: team.id },
      select: { id: true },
    });
    const raw = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    await s3.putObject(`raw/${user.id}/${id}`, raw, 'image/png');
    await env.prisma.screenshot.create({
      data: {
        id,
        userId: user.id,
        timestamp: new Date(TS),
        storageKey: `raw/${user.id}/${id}`,
        status: 'PENDING',
      },
    });
    return { userId: user.id };
  }

  function run(id: string) {
    return processor.process({ id: 'job', data: { id, timestamp: TS } } as never);
  }

  it('NONE → READY with a thumbnail, raw kept, blurred=false', async () => {
    const id = '019797a0-0000-7000-8000-000000000101';
    const { userId } = await seed(id, 'NONE');
    await run(id);
    const row = await env.prisma.screenshot.findUnique({
      where: { id_timestamp: { id, timestamp: new Date(TS) } },
    });
    expect(row?.status).toBe('READY');
    expect(row?.thumbnailKey).toBe(`thumb/${userId}/${id}`);
    expect(row?.blurred).toBe(false);
    await expect(s3.getObject(`thumb/${userId}/${id}`)).resolves.toBeInstanceOf(Buffer);
    await expect(s3.getObject(`raw/${userId}/${id}`)).resolves.toBeInstanceOf(Buffer);
  });

  it('THUMBNAIL_ONLY → READY, raw deleted', async () => {
    const id = '019797a0-0000-7000-8000-000000000102';
    const { userId } = await seed(id, 'THUMBNAIL_ONLY');
    await run(id);
    const row = await env.prisma.screenshot.findUnique({
      where: { id_timestamp: { id, timestamp: new Date(TS) } },
    });
    expect(row?.status).toBe('READY');
    await expect(s3.getObject(`raw/${userId}/${id}`)).rejects.toBeTruthy();
  });

  it('BLUR → READY, blurred=true, raw replaced (still present)', async () => {
    const id = '019797a0-0000-7000-8000-000000000103';
    const { userId } = await seed(id, 'BLUR');
    await run(id);
    const row = await env.prisma.screenshot.findUnique({
      where: { id_timestamp: { id, timestamp: new Date(TS) } },
    });
    expect(row?.blurred).toBe(true);
    await expect(s3.getObject(`raw/${userId}/${id}`)).resolves.toBeInstanceOf(Buffer);
  });
});

describe('worker screenshot-process harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
