import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { WorkerPrisma } from '../infra/prisma.provider.js';
import { aggregateSamples } from './rollup-aggregate.js';
import { dhakaWindow, previousDhakaDay } from './rollup-daily.util.js';

/**
 * PRD §6.3 — aggregate the previous Dhaka day's activity_samples per user into one
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
    const day = job.data?.day ?? previousDhakaDay(new Date());
    const { dayLabel, from, to } = dhakaWindow(day);

    const samples = await this.prisma.activitySample.findMany({
      where: { timestamp: { gte: from, lt: to } },
      select: { userId: true, appName: true, category: true, activityPct: true },
    });

    const rollups = aggregateSamples(samples);
    for (const r of rollups) {
      await this.prisma.activityDailySummary.upsert({
        where: { userId_day: { userId: r.userId, day: dayLabel } },
        create: {
          userId: r.userId,
          day: dayLabel,
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
      { day, users: rollups.length, samples: samples.length },
      'rollup-daily complete',
    );
  }
}
