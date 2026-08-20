import { Prisma, type PrismaClient } from '@timetrack/db';

/**
 * The two per-user weekly measures both weekly emails need. Shared so the summary and the
 * reminder can never disagree about what "hours tracked last week" means.
 *
 * Deliberately NOT read from `timesheet_approvals.totalSeconds`: that column is null until a
 * manager decides, and the reminder's whole point is the weeks nobody has looked at yet.
 */

/**
 * The effective end of a time entry. A CLOSED entry ends at its `endTime`. An OPEN entry ends
 * at whichever comes first: now, or its last heartbeat plus the freshness window — so a client
 * that has stopped heartbeating (crash, sleep, shutdown) stops accruing duration instead of
 * growing without bound (spec §4.3).
 *
 * Rows written before `heartbeatAt` existed have null, and fall back to `startTime`.
 *
 * DUPLICATED, deliberately, from the CANONICAL `ENTRY_END` at
 * `apps/api/src/modules/reports/reports.repository.ts:32`. `apps/worker` may not import from
 * `apps/api` (CLAUDE.md §3), so the two copies are kept identical by hand — change one, change
 * the other. This file already mirrors an API expression for the same reason.
 *
 * Assumes the `time_entries` table is aliased `te` in the surrounding query.
 */
const ENTRY_END = (freshnessSeconds: number): Prisma.Sql => Prisma.sql`
  COALESCE(
    te."endTime",
    LEAST(
      now(),
      COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => ${freshnessSeconds})
    )
  )`;

/**
 * Whole-second duration of one entry clamped to [from, to) — the same expression the API's
 * REPORTS repository measures with, so a weekly email and the dashboard agree to the second.
 *
 * A still-open entry ends at the staleness clamp above, NOT at `now()`: for a CLOSED week an
 * unclamped `now()` resolves to `to`, so one entry a user forgot to stop reported the whole
 * period — roughly 159 hours for a Monday-morning start — in an automated email with no human
 * in the loop.
 *
 * It is deliberately NOT the expression `approvals.repository.ts` snapshots with any more:
 * approvals is excluded from the clamp on purpose (spec §10.1 — its totals back timesheets a
 * manager may already have signed). Do not "restore consistency" by dropping the clamp here.
 */
const CLAMPED_SECONDS = (from: Prisma.Sql, to: Prisma.Sql, freshnessSeconds: number): Prisma.Sql =>
  Prisma.sql`
  FLOOR(GREATEST(EXTRACT(EPOCH FROM (
    date_trunc('second', LEAST(${ENTRY_END(freshnessSeconds)}, ${to}))
    - date_trunc('second', GREATEST(te."startTime", ${from}))
  )), 0))::int`;

/** Tracked seconds per user over [from, to). Users with no entries are absent from the map. */
export async function trackedSecondsByUser(
  prisma: PrismaClient,
  userIds: string[],
  from: Date,
  to: Date,
  freshnessSeconds: number,
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ userId: string; seconds: number | bigint }>>`
    SELECT te."userId" AS "userId",
           COALESCE(SUM(${CLAMPED_SECONDS(
             Prisma.sql`${from}::timestamptz`,
             Prisma.sql`${to}::timestamptz`,
             freshnessSeconds,
           )}), 0)::int AS "seconds"
    FROM time_entries te
    WHERE te."userId" IN (${Prisma.join(userIds)})
      AND te."startTime" < ${to}::timestamptz
      AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
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
 *
 * `s.day` is a Dhaka calendar day (`rollup-daily.util.ts`'s `dhakaWindow`), so the query
 * projects `from`/`to` through `Asia/Dhaka`, not `UTC`, to match. `from`/`to` themselves stay
 * the UTC-anchored closed week (`closed-week.ts`) — deliberately, so `weekLabel` and
 * `TimesheetApproval.periodStart` stay self-consistent (see `CLAMPED_SECONDS` above). That
 * leaves an accepted mismatch: at each week edge this activity % is computed over a window
 * six hours off from the tracked-seconds figure in the same email. Not to be "fixed" here.
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
    -- Dhaka day labels — see the doc comment above.
    WHERE s."userId" IN (${Prisma.join(userIds)})
      AND s.day >= (${from}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date
      AND s.day <  (${to}::timestamptz AT TIME ZONE 'Asia/Dhaka')::date
    GROUP BY s."userId"
    HAVING SUM(s."activeMinutes") > 0
  `;
  return new Map(rows.map((r) => [r.userId, Number(r.pct)]));
}
