import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';

describe('HealthController', () => {
  it('liveness returns ok without touching the database', () => {
    const ctrl = new HealthController({} as unknown as PrismaService);
    expect(ctrl.liveness()).toEqual({ status: 'ok' });
  });

  it('readiness returns ok when the database query succeeds', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    const ctrl = new HealthController(prisma);
    await expect(ctrl.readiness()).resolves.toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('readiness throws 503 when the database is unreachable', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as PrismaService;
    const ctrl = new HealthController(prisma);
    await expect(ctrl.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
