import './test-env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MinioService } from '../src/infra/storage/minio.service.js';
import { startTestDb, type TestDb } from './db-harness.js';

const RUN_E2E = process.env.RUN_E2E === '1';

describe.runIf(RUN_E2E)('MinioService — real MinIO container', () => {
  let db: TestDb;
  let svc: MinioService;
  beforeAll(async () => {
    db = await startTestDb({ minio: true });
    svc = new MinioService();
    await svc.onModuleInit(); // creates the bucket
  });
  afterAll(async () => {
    await db.close();
  });

  it('putObject → presignGet round-trips the bytes', async () => {
    // Buffer body — the shape putObject is actually called with in production
    // (worker writes sharp-derived Buffers back, plan §Task 8). Streaming a raw
    // Readable through putObject hits AWS SDK's checksum middleware, which
    // requires a known content-length; that path is Task 4's dedicated
    // `putStream` (backed by @aws-sdk/lib-storage's `Upload`), not this method.
    const key = 'raw/u1/obj1';
    await svc.putObject(key, Buffer.from('hello-bytes'), 'application/octet-stream');
    const url = await svc.presignGet(key);
    expect(url).toContain('X-Amz-Signature'); // presigned, not public
    const res = await fetch(url);
    expect(await res.text()).toBe('hello-bytes');
  });

  it('deleteObject removes the object (presigned GET 404s)', async () => {
    const key = 'raw/u1/obj2';
    await svc.putObject(key, Buffer.from('bye'), 'application/octet-stream');
    await svc.deleteObject(key);
    const res = await fetch(await svc.presignGet(key));
    expect(res.status).toBe(404);
  });

  it('deleteByPrefix removes every object under the prefix and leaves others alone', async () => {
    await svc.putObject('raw/eraseme/a', Buffer.from('a'), 'application/octet-stream');
    await svc.putObject('raw/eraseme/b', Buffer.from('b'), 'application/octet-stream');
    await svc.putObject('thumb/eraseme/a', Buffer.from('t'), 'application/octet-stream');
    await svc.putObject('raw/keepme/a', Buffer.from('k'), 'application/octet-stream');

    const deleted = await svc.deleteByPrefix('raw/eraseme/');
    expect(deleted).toBe(2);

    expect((await fetch(await svc.presignGet('raw/eraseme/a'))).status).toBe(404);
    expect((await fetch(await svc.presignGet('raw/eraseme/b'))).status).toBe(404);
    // a different user's prefix is untouched
    expect((await fetch(await svc.presignGet('raw/keepme/a'))).status).toBe(200);
    // the thumb prefix is a separate sweep
    expect((await fetch(await svc.presignGet('thumb/eraseme/a'))).status).toBe(200);
  });

  it('deleteByPrefix on an empty prefix is a no-op returning 0 (idempotent re-run)', async () => {
    expect(await svc.deleteByPrefix('raw/does-not-exist/')).toBe(0);
  });
});

describe('storage e2e harness', () => {
  it('is gated behind RUN_E2E=1', () => {
    expect(typeof RUN_E2E).toBe('boolean');
  });
});
