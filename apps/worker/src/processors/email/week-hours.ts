import { Prisma, type PrismaClient } from '@timetrack/db';

/**
 * The two per-user weekly measures both weekly emails need. Shared so the summary and the
 * reminder can never disagree about what "hours tracked last week" means.
 *
 * Deliberately NOT read from `timesheet_approvals.totalSeconds`: that column is null until a
 * manager decides, and the reminder's whole point is the weeks nobody has looked at yet.
 */

/**
 * Whole-second duration of one entry clamped to [from, to) — the same expression the API's
 * approvals repository snapshots with, so an email and the dashboard agree to the second.
 * A still-open entry is clamped at `now()`, which for a closed week is simply `to`.
 */
const CLAMPED_SECONDS = (from: Prisma.Sql, to: Prisma.Sql): Prisma.Sql => Prisma.sql`
  FLOOR(GREATEST(EXTRACT(EPOCH FROM (
    date_trunc('second', LEAST(COALESCE(te."endTime", now()), ${to}))
    - date_trunc('second', GREATEST(te."startTime", ${from}))
  )), 0))::int`;

/** Tracked seconds per user over [from, to). Users with no entries are absent from the map. */
export async function trackedSecondsByUser(
  prisma: PrismaClient,
  userIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ userId: string; seconds: number | bigint }>>`
    SELECT te."userId" AS "userId",
           COALESCE(SUM(${CLAMPED_SECONDS(
             Prisma.sql`${from}::timestamptz`,
             Prisma.sql`${to}::timestamptz`,
           )}), 0)::int AS "seconds"
    FROM time_entries te
    WHERE te."userId" IN (${Prisma.join(userIds)})
      AND te."startTime" < ${to}::timestamptz
      AND COALESCE(te."endTime", now()) > ${from}::timestamptz
    GROUP BY te."userId"
  `;
  return new Map(rows.map((r) => [r.userId, Number(r.seconds)]));
}

/**
 * Activity % per user over the days of [from, to), weighted by each day's active minutes — an
 * unweighted mean would let a 5-minute Friday outweigh a full Tuesday. Reads the small,
 * UNPARTITIONED `activity_daily_summaries` (the worker's own rollup), not `activity_samples`.
 * A user with no rolled-up active minutes is absent from the map, not zero: "no data" and
 * "idle all week" are different facts and the email says so.
 */
export async function weightedActivityPctByUser(
  prisma: PrismaClient,
  userIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ userId: string; pct: number | bigint }>>`
    SELECT s."userId" AS "userId",
           ROUND(
             SUM(s."avgActivityPct"::numeric * s."activeMinutes") / SUM(s."activeMinutes")
           )::int AS "pct"
    FROM activity_daily_summaries s
    WHERE s."userId" IN (${Prisma.join(userIds)})
      AND s.day >= (${from}::timestamptz AT TIME ZONE 'UTC')::date
      AND s.day <  (${to}::timestamptz AT TIME ZONE 'UTC')::date
    GROUP BY s."userId"
    HAVING SUM(s."activeMinutes") > 0
  `;
  return new Map(rows.map((r) => [r.userId, Number(r.pct)]));
}
