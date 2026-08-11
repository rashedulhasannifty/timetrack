import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { QueueService } from '../../infra/queue/queue.module.js';
import type { MinioService } from '../../infra/storage/minio.service.js';

function make(
  opts: { database?: boolean; redis?: boolean; storage?: boolean } = {},
): HealthController {
  const { database = true, redis = true, storage = true } = opts;
  const fail = (name: string) => vi.fn().mockRejectedValue(new Error(`${name} down`));
  return new HealthController(
    {
      $queryRaw: database ? vi.fn().mockResolvedValue([{ '?column?': 1 }]) : fail('db'),
    } as unknown as PrismaService,
    {
      ping: redis ? vi.fn().mockResolvedValue(undefined) : fail('redis'),
    } as unknown as QueueService,
    {
      ping: storage ? vi.fn().mockResolvedValue(undefined) : fail('storage'),
    } as unknown as MinioService,
  );
}

describe('HealthController', () => {
  it('liveness returns ok without touching any dependency', () => {
    expect(make().liveness()).toEqual({ status: 'ok' });
  });

  it('readiness reports every dependency, not just the database', async () => {
    await expect(make().readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up', storage: 'up' },
    });
  });

  it.each([
    ['database', { database: false }],
    ['redis', { redis: false }],
    ['storage', { storage: false }],
  ])('readiness throws 503 when %s is unreachable', async (_name, opts) => {
    await expect(make(opts).readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('names which dependencies are down, and keeps the up/down detail in the body', async () => {
    try {
      await make({ redis: false, storage: false }).readiness();
      expect.unreachable('expected a 503');
    } catch (err) {
      const res = (err as ServiceUnavailableException).getResponse() as {
        title: string;
        checks: Record<string, string>;
      };
      expect(res.title).toContain('redis');
      expect(res.title).toContain('storage');
      expect(res.checks).toEqual({ database: 'up', redis: 'down', storage: 'down' });
    }
  });

  it('does not leak driver text or connection details in the error', async () => {
    try {
      await make({ database: false }).readiness();
      expect.unreachable('expected a 503');
    } catch (err) {
      const body = JSON.stringify((err as ServiceUnavailableException).getResponse());
      expect(body).not.toContain('db down');
    }
  });

  it('treats a hung dependency as down rather than hanging the probe', async () => {
    const ctrl = new HealthController(
      { $queryRaw: vi.fn().mockResolvedValue([{}]) } as unknown as PrismaService,
      { ping: vi.fn().mockReturnValue(new Promise(() => {})) } as unknown as QueueService,
      { ping: vi.fn().mockResolvedValue(undefined) } as unknown as MinioService,
    );
    await expect(ctrl.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  }, 10_000);
});
