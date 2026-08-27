import { describe, expect, it, vi } from 'vitest';
import { ensureBucket } from './minio.service.js';

/**
 * Boot-time bucket reconciliation. Split out from `MinioService` so it can be tested without an
 * `S3Client` — the service builds its clients in field initialisers, and the interesting
 * behaviour here is entirely about which errors mean "fine" and which mean "stop".
 */
describe('ensureBucket', () => {
  const awsError = (name: string, httpStatusCode: number): Error =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

  it('does nothing when the bucket is already there', async () => {
    const create = vi.fn();

    const outcome = await ensureBucket({ head: () => Promise.resolve(), create });

    expect(outcome).toBe('present');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the bucket when it is missing', async () => {
    const create = vi.fn().mockResolvedValue(undefined);

    const outcome = await ensureBucket({
      head: () => Promise.reject(awsError('NotFound', 404)),
      create,
    });

    expect(outcome).toBe('created');
    expect(create).toHaveBeenCalledOnce();
  });

  /**
   * The bug this file exists for. Two API instances booting together — a rolling deploy, a
   * replica, an API restarted beside the worker — both see no bucket and both create it. The
   * loser used to take the whole process down on a condition that means the desired end state
   * was reached.
   */
  it.each(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'])(
    'treats %s from a concurrent creator as success',
    async (name) => {
      const outcome = await ensureBucket({
        head: () => Promise.reject(awsError('NotFound', 404)),
        create: () => Promise.reject(awsError(name, 409)),
      });

      expect(outcome).toBe('raced');
    },
  );

  it('accepts a 409 whose error name it does not recognise', async () => {
    const outcome = await ensureBucket({
      head: () => Promise.reject(awsError('NotFound', 404)),
      create: () => Promise.reject(awsError('SomeVendorSpecificConflict', 409)),
    });

    expect(outcome).toBe('raced');
  });

  /**
   * The second fault in the old shape: a blanket `catch` answered a credentials failure by
   * trying to CREATE the bucket, so the operator saw a confusing creation error instead of the
   * authentication one that actually happened.
   */
  it('does not try to create the bucket when the head fails for any other reason', async () => {
    const create = vi.fn();
    const forbidden = awsError('Forbidden', 403);

    await expect(ensureBucket({ head: () => Promise.reject(forbidden), create })).rejects.toBe(
      forbidden,
    );

    expect(create).not.toHaveBeenCalled();
  });

  it('propagates a connection failure that carries no HTTP status at all', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' });
    const create = vi.fn();

    await expect(ensureBucket({ head: () => Promise.reject(refused), create })).rejects.toBe(
      refused,
    );

    expect(create).not.toHaveBeenCalled();
  });

  /**
   * A genuine creation failure still fails the boot, deliberately: an API that cannot reach its
   * object store cannot serve screenshots, and starting up to fail every upload is worse than
   * not starting.
   */
  it('propagates a creation failure that is not a race', async () => {
    const denied = awsError('AccessDenied', 403);

    await expect(
      ensureBucket({
        head: () => Promise.reject(awsError('NotFound', 404)),
        create: () => Promise.reject(denied),
      }),
    ).rejects.toBe(denied);
  });
});
