import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { aggregateSamples } from './rollup-aggregate.js';

/** Start-of-day (UTC) for a 'YYYY-MM-DD' string. */
function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Previous full UTC day (start-of-day), relative to now. */
function previousUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
}

/**
 * PRD §6.3 — aggregate the previous UTC day's activity_samples per user into one
 * activity_daily_summaries row (avg activity %, active minutes, minutes per app/category).
 * Off the request path. Never logs windowTitle (redacted; not read here).
 */
@Injectable()
@Processor('rollup-daily')
export class RollupDailyProcessor extends WorkerHost {
  constructor(
    private readonly prisma: WorkerPrisma,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ day?: string }>): Promise<void> {
    const dayStart = job.data?.day ? utcDay(job.data.day) : previousUtcDay();
    const nextDay = new Date(dayStart);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const samples = await this.prisma.activitySample.findMany({
      where: { timestamp: { gte: dayStart, lt: nextDay } },
      select: { userId: true, appName: true, category: true, activityPct: true },
    });

    const rollups = aggregateSamples(samples);
    for (const r of rollups) {
      await this.prisma.activityDailySummary.upsert({
        where: { userId_day: { userId: r.userId, day: dayStart } },
        create: {
          userId: r.userId,
          day: dayStart,
          avgActivityPct: r.avgActivityPct,
          activeMinutes: r.activeMinutes,
          byApp: r.byApp,
          byCategory: r.byCategory,
        },
        update: {
          avgActivityPct: r.avgActivityPct,
          activeMinutes: r.activeMinutes,
          byApp: r.byApp,
          byCategory: r.byCategory,
        },
      });
    }

    this.logger.log(
      { day: dayStart.toISOString().slice(0, 10), users: rollups.length, samples: samples.length },
      'rollup-daily complete',
    );
  }
}
