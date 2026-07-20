import type { PrismaClient } from '@timetrack/db';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const LOOKBACK_WEEKS = 4;

/**
 * Regenerate PENDING timesheet approvals for the last `lookbackWeeks` CLOSED ISO weeks.
 * A rolling window (not just the just-closed week) is deliberate: this is an offline-first
 * app, so a client may sync a week's entries days late — after that week's Monday cron.
 * Re-checking recent weeks lets those late syncs still surface in the manager's queue.
 *
 * `periodStart` is derived with `date_trunc('week', ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
 * (Postgres weeks are Monday-start/ISO), byte-identical across runs so the
 * `(userId, periodStart)` unique key is stable and `createMany({ skipDuplicates })` is a true
 * upsert-if-missing — it never clobbers a decided row. Returns the count of NEW rows.
 */
export async function generatePendingTimesheets(
  prisma: PrismaClient,
  now: Date,
  lookbackWeeks = LOOKBACK_WEEKS,
): Promise<number> {
  // Candidate (userId, weekStart) pairs: active users with >0 raw tracked seconds for entries
  // STARTING within a closed in-window week. weekStart/currentWeekStart are UTC Monday instants.
  const candidates = await prisma.$queryRaw<Array<{ userId: string; periodStart: Date | string }>>`
    WITH bounds AS (
      SELECT (date_trunc('week', ${now}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS current_week_start
    )
    SELECT te."userId" AS "userId",
           (date_trunc('week', te."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS "periodStart"
    FROM time_entries te
    JOIN users u ON u.id = te."userId" AND u."deactivatedAt" IS NULL
    CROSS JOIN bounds b
    WHERE (date_trunc('week', te."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
            >= b.current_week_start - make_interval(weeks => ${lookbackWeeks})
      AND (date_trunc('week', te."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
            < b.current_week_start
    GROUP BY te."userId", (date_trunc('week', te."startTime" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    HAVING SUM(EXTRACT(EPOCH FROM (COALESCE(te."endTime", now()) - te."startTime"))) > 0
  `;

  if (candidates.length === 0) return 0;

  const data = candidates.map((c) => {
    const periodStart = new Date(c.periodStart); // pg may hand back Date OR string
    return { userId: c.userId, periodStart, periodEnd: new Date(periodStart.getTime() + WEEK_MS) };
  });

  const res = await prisma.timesheetApproval.createMany({ data, skipDuplicates: true });
  return res.count;
}
