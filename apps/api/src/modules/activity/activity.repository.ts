import { Injectable } from '@nestjs/common';
import type { ActivitySample, ListActivityQuery } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// Never select `*` — the read shape mirrors ActivitySampleSchema exactly.
const ACTIVITY_SELECT = {
  id: true,
  timestamp: true,
  appName: true,
  windowTitle: true,
  activityPct: true,
  category: true,
} as const;

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

  /** Self/manager read, bounded by [from, to] on the partition key `timestamp`. */
  async list(query: ListActivityQuery & { userId: string }): Promise<ActivitySample[]> {
    const rows = await this.prisma.activitySample.findMany({
      where: {
        userId: query.userId,
        timestamp: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      orderBy: { timestamp: 'asc' },
      select: ACTIVITY_SELECT,
    });
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      appName: r.appName,
      windowTitle: r.windowTitle,
      activityPct: r.activityPct,
      category: r.category,
    }));
  }
}
