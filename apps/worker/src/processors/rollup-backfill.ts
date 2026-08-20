import { dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';
import type { PrismaClient } from '@timetrack/db';
import { aggregateSamples } from './rollup-aggregate.js';
import { dhakaWindow, previousDhakaDay } from './rollup-daily.util.js';

/**
 * One-off driver behind `scripts/backfill-dhaka-rollups.ts`: re-buckets
 * `activity_daily_summaries` from UTC days onto Dhaka days (spec §3.4).
 *
 * Lives here rather than in the script because it owns a data-DESTRUCTIVE decision (which
 * stale UTC-bucketed rows may be removed) and therefore has to be reachable from the
 * Testcontainers suite. It is not a BullMQ processor and is never enqueued;
 * `rollup-daily.processor.ts` writes the correct Dhaka label from its first run, so no
 * phantom row can arise going forward and the processor needs no delete.
 *
 * Returns a report; it never prints. `console` is banned outside `scripts/`.
 */

export interface UserAlignment {
  userId: string;
  /** Oldest surviving activity_sample for this user — their retention floor. */
  oldestSample: Date;
  /** First Dhaka day whose rebuilt row is COMPLETE for this user. */
  alignedFrom: string;
  /** True when the floor day itself was rebuilt from a partial window, so it understates. */
  floorDayPartial: boolean;
}

export interface BackfillReport {
  /** Oldest surviving sample across all users, or null when there are none. */
  oldestSample: Date | null;
  /** Inclusive Dhaka-day range actually walked; null when nothing could be rebuilt. */
  firstDay: string | null;
  lastDay: string | null;
  /** Days walked (a day with no samples is still walked — it may hold stale rows). */
  daysWalked: number;
  upsertedRows: number;
  deletedStaleRows: number;
  /** Per-user alignment, for users with surviving samples. Ordered by userId. */
  users: UserAlignment[];
  /**
   * Users holding summary rows but with no surviving samples at all: retention purged
   * everything, nothing was rebuilt, and every one of their rows keeps UTC-shaped numbers.
   */
  unrebuildableUserIds: string[];
}

/**
 * Rebuild every Dhaka day from the oldest surviving sample up to the Dhaka day before `now`.
 *
 * Idempotent. Safe to re-run.
 *
 * **The delete rule.** Re-bucketing moves minutes onto a new day label, so the row the old
 * UTC rollup wrote must go — otherwise the same minutes are counted under two labels. But a
 * blanket `deleteMany({ day })` would also erase rows whose samples retention already purged
 * (`retention-cleanup.processor.ts` purges per TEAM policy, so the single global sample floor
 * is set by the longest-retention team). Those rows are stale but unrebuildable, and stale
 * numbers beat no numbers.
 *
 * So a row is deleted only when it is above **that user's own** sample floor:
 * `floorDay(user) < day`, and the day's aggregate did not just write that user. At or below a
 * user's floor, their rows are left untouched.
 *
 * Known residual gap, deliberately not closed here: the floor is the user's oldest SURVIVING
 * sample, which cannot distinguish "purged" from "the user simply had no earlier activity".
 * A user whose entire history is one late-evening-UTC stint therefore has a floor day equal to
 * the Dhaka day their work lands on, no delete fires, and their old UTC-labelled row survives
 * alongside the new one. Closing that needs a per-team retention-policy horizon, which carries
 * its own wrongful-delete hazard (a team whose retention was raised has data purged under the
 * older, shorter policy) and needs sign-off. See the spec §3.4 note.
 */
export async function rebuildDhakaRollups(
  prisma: PrismaClient,
  now: Date,
): Promise<BackfillReport> {
  const floorRows = await prisma.activitySample.groupBy({
    by: ['userId'],
    _min: { timestamp: true },
  });
  const floors = new Map<string, Date>();
  for (const row of floorRows) {
    const min = row._min.timestamp;
    if (min) floors.set(row.userId, min);
  }

  const summaryOwners = await prisma.activityDailySummary.groupBy({ by: ['userId'] });
  const unrebuildableUserIds = summaryOwners
    .map((s) => s.userId)
    .filter((id) => !floors.has(id))
    .sort();

  const users: UserAlignment[] = [...floors.entries()]
    .map(([userId, oldestSample]) => {
      const floorDay = dayOf(oldestSample);
      // The floor day's window opens at Dhaka midnight, but the oldest surviving sample sits
      // somewhere inside it unless it lands exactly on the boundary — so that day is only
      // ever partially rebuilt, and the first complete day is the one after it.
      const whole = dayStartInstant(floorDay).getTime() >= oldestSample.getTime();
      return {
        userId,
        oldestSample,
        alignedFrom: whole ? floorDay : shiftDay(floorDay, 1),
        floorDayPartial: !whole,
      };
    })
    .sort((a, b) => a.userId.localeCompare(b.userId));

  const report: BackfillReport = {
    oldestSample: null,
    firstDay: null,
    lastDay: null,
    daysWalked: 0,
    upsertedRows: 0,
    deletedStaleRows: 0,
    users,
    unrebuildableUserIds,
  };
  if (floors.size === 0) return report;

  let oldestMs = Number.POSITIVE_INFINITY;
  for (const ts of floors.values()) oldestMs = Math.min(oldestMs, ts.getTime());
  const oldestSample = new Date(oldestMs);
  const firstDay = dayOf(oldestSample);
  const lastDay = previousDhakaDay(now);
  report.oldestSample = oldestSample;
  report.firstDay = firstDay;
  report.lastDay = lastDay;
  if (firstDay > lastDay) return report; // 'YYYY-MM-DD' sorts chronologically.

  const floorDays = new Map<string, string>();
  for (const [userId, ts] of floors) floorDays.set(userId, dayOf(ts));

  for (let day = firstDay; day <= lastDay; day = shiftDay(day, 1)) {
    const { dayLabel, from, to } = dhakaWindow(day);
    const samples = await prisma.activitySample.findMany({
      where: { timestamp: { gte: from, lt: to } },
      select: { userId: true, appName: true, category: true, activityPct: true },
    });

    const written = new Set<string>();
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
      written.add(r.userId);
      report.upsertedRows += 1;
    }

    // Runs even when the window was wholly empty — an empty window is exactly the case that
    // leaves a phantom row behind (the night worker whose minutes moved to the next label).
    const stale = [...floorDays.entries()]
      .filter(([userId, floorDay]) => floorDay < day && !written.has(userId))
      .map(([userId]) => userId);
    if (stale.length > 0) {
      const { count } = await prisma.activityDailySummary.deleteMany({
        where: { day: dayLabel, userId: { in: stale } },
      });
      report.deletedStaleRows += count;
    }

    report.daysWalked += 1;
  }

  return report;
}
