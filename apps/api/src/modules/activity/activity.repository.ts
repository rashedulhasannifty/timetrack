import { Injectable } from '@nestjs/common';
import type { ActivitySample } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class ActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * PRD §7.5 — each sample carries a client-minted UUIDv7, so a retried offline batch
   * is a no-op: skipDuplicates makes the insert idempotent. `windowTitle` is redacted
   * in logs by packages/logger, never here.
   */
  async insertBatch(userId: string, samples: ActivitySample[]): Promise<number> {
    const res = await this.prisma.activitySample.createMany({
      data: samples.map((s) => ({
        id: s.id,
        userId,
        timestamp: new Date(s.timestamp),
        appName: s.appName,
        windowTitle: s.windowTitle,
        activityPct: s.activityPct,
        category: s.category,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }
}
