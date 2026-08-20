/**
 * One-off: rebuild activity_daily_summaries on Dhaka day boundaries.
 *
 * Existing rows were bucketed on UTC days. This re-runs the rollup for every Dhaka day that
 * still has surviving activity_samples, and removes the stale UTC-bucketed rows the rebuild
 * supersedes — but only above each user's OWN sample floor, so rows whose samples retention
 * has already purged are preserved with their old UTC-shaped numbers rather than erased.
 * The alignment date is reported PER USER, because retention is enforced per team and there
 * is no single global date from which every user's data is Dhaka-aligned.
 *
 * All the logic (and the data-destructive delete rule) lives in
 * `src/processors/rollup-backfill.ts`, which the worker Testcontainers suite exercises.
 * This file is only wiring and printing.
 *
 * Run AFTER deploying the Dhaka rollup processor. Idempotent: re-running is a no-op.
 */
import { PrismaClient, pgAdapter } from '@timetrack/db';
import { loadEnv } from '@timetrack/config';
import { rebuildDhakaRollups } from '../src/processors/rollup-backfill.js';

const env = loadEnv();
const prisma = new PrismaClient({ adapter: pgAdapter(env.DATABASE_URL) });

async function main(): Promise<void> {
  const report = await rebuildDhakaRollups(prisma, new Date());

  if (report.firstDay === null || report.lastDay === null) {
    console.log('no activity samples — nothing to rebuild');
  } else {
    console.log(`walked Dhaka days ${report.firstDay} .. ${report.lastDay}`);
    console.log(
      `${report.daysWalked} days walked, ${report.upsertedRows} summary rows written, ` +
        `${report.deletedStaleRows} stale UTC-bucketed rows removed`,
    );
  }

  console.log('');
  console.log('ALIGNMENT IS PER USER — there is no single global cutoff, because');
  console.log('activity_samples retention is enforced per team.');

  if (report.users.length > 0) {
    console.log('');
    console.log('Dhaka-aligned from (rows BEFORE this day keep UTC-shaped numbers):');
    for (const u of report.users) {
      const partial = u.floorDayPartial
        ? ` — the day before ${u.alignedFrom} was rebuilt from a partial window`
        : '';
      console.log(
        `  ${u.userId}  from ${u.alignedFrom}  (oldest surviving sample ` +
          `${u.oldestSample.toISOString()})${partial}`,
      );
    }
  }

  if (report.unrebuildableUserIds.length > 0) {
    console.log('');
    console.log(
      'NOT ALIGNED AT ALL — no surviving samples, every summary row keeps UTC-shaped numbers:',
    );
    for (const userId of report.unrebuildableUserIds) console.log(`  ${userId}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
