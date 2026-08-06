import { Injectable } from '@nestjs/common';
import type { ActivityDailySummary, ActivitySample, ListActivityQuery } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

// Never select `*` — the read shape mirrors ActivitySampleSchema exactly.
const ACTIVITY_SELECT = {
  id: true,
  timestamp: true,
  appName: true,
  bundleId: true,
  windowTitle: true,
  activityPct: true,
  category: true,
} as const;

// Never select `*` — mirrors ActivityDailySummarySchema exactly.
const SUMMARY_SELECT = {
  userId: true,
  day: true,
  avgActivityPct: true,
  activeMinutes: true,
  byApp: true,
  byCategory: true,
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
        bundleId: s.bundleId ?? null,
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
      bundleId: r.bundleId,
      windowTitle: r.windowTitle,
      activityPct: r.activityPct,
      category: r.category,
    }));
  }

  /** Self/manager read of daily summaries, windowed on `day` (a @db.Date). */
  async listSummaries(query: {
    userId: string;
    from: string;
    to: string;
  }): Promise<ActivityDailySummary[]> {
    const rows = await this.prisma.activityDailySummary.findMany({
      where: {
        userId: query.userId,
        day: { gte: new Date(query.from), lte: new Date(query.to) },
      },
      orderBy: { day: 'asc' },
      select: SUMMARY_SELECT,
    });
    return rows.map((r) => ({
      userId: r.userId,
      day: r.day.toISOString().slice(0, 10),
      avgActivityPct: r.avgActivityPct,
      activeMinutes: r.activeMinutes,
      byApp: r.byApp as Record<string, number>,
      byCategory: r.byCategory as Record<string, number>,
    }));
  }
}
