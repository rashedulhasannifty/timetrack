/**
 * One-off: rebuild activity_daily_summaries on Dhaka day boundaries.
 *
 * Existing rows were bucketed on UTC days. This re-runs the rollup for every Dhaka day that
 * still has surviving activity_samples. Days whose samples retention has already purged
 * CANNOT be rebuilt — their rows keep their old UTC-shaped numbers, and the script reports
 * the date from which the data is trustworthy so nobody reads older figures as Dhaka-aligned.
 *
 * Run AFTER deploying the Dhaka rollup processor. Idempotent: re-running is a no-op.
 */
import { dayOf, shiftDay } from '@timetrack/contracts';
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { loadEnv } from '@timetrack/config';
import { aggregateSamples } from '../src/processors/rollup-aggregate.js';
import { dhakaWindow } from '../src/processors/rollup-daily.util.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) });

async function main(): Promise<void> {
  const oldest = await prisma.activitySample.findFirst({
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true },
  });
  if (!oldest) {
    console.log('no activity samples — nothing to rebuild');
    return;
  }

  const firstDay = dayOf(oldest.timestamp);
  // `firstDay`'s window starts at Dhaka midnight, but retention already purged everything
  // before `oldest.timestamp` — which sits somewhere inside that window unless the oldest
  // surviving sample happens to land exactly on the boundary. So `firstDay` itself is only
  // ever partially rebuilt; the first FULLY trustworthy day is the one after it.
  const firstFullDay =
    dhakaWindow(firstDay).from.getTime() >= oldest.timestamp.getTime()
      ? firstDay
      : shiftDay(firstDay, 1);
  const lastDay = shiftDay(dayOf(new Date()), -1);
  console.log(`rebuilding Dhaka rollups from ${firstDay} to ${lastDay}`);

  let rebuilt = 0;
  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    const { dayLabel, from, to } = dhakaWindow(day);
    const samples = await prisma.activitySample.findMany({
      where: { timestamp: { gte: from, lt: to } },
      select: { userId: true, appName: true, category: true, activityPct: true },
    });
    if (samples.length === 0) continue;

    for (const r of aggregateSamples(samples)) {
      await prisma.activityDailySummary.upsert({
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
    rebuilt += 1;
  }

  console.log(`rebuilt ${rebuilt} Dhaka days`);
  if (firstFullDay !== firstDay) {
    console.log(
      `${firstDay} was rebuilt from a partial window — retention had already purged samples ` +
        `before ${oldest.timestamp.toISOString()}, so its numbers understate that day.`,
    );
  }
  console.log(`ACTIVITY ROLLUPS ARE DHAKA-ALIGNED FROM ${firstFullDay} ONWARD.`);
  const partialNote = firstFullDay !== firstDay ? ` (including the partial ${firstDay} row)` : '';
  console.log(
    `Rows before ${firstFullDay}${partialNote} keep UTC-shaped or incomplete numbers — their ` +
      `samples are already purged.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
