import { Prisma, type PrismaClient } from '@timetrack/db';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const LOOKBACK_WEEKS = 4;

/**
 * The effective end of a time entry — see the canonical `ENTRY_END` at
 * `apps/api/src/modules/reports/reports.repository.ts:32`, duplicated here because
 * `apps/worker` may not import from `apps/api` (CLAUDE.md §3). Change one, change the other.
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
 * Does this entry count as EVIDENCE that the user worked the week? Closed entries always do.
 * An OPEN entry does only while its heartbeat is still fresh — a live timer that started just
 * before the week closed and is still running when the Monday cron fires is real work.
 *
 * A STALE open entry (crash, shutdown, sleep) is not. Without this, a single row a user forgot
 * to stop manufactures a PENDING TimesheetApproval for a week they may never have worked, and
 * `approvals.repository.ts` — deliberately un-clamped, spec §10.1 — then shows a manager that
 * phantom week with an inflated `trackedSeconds`. Clamping the summed duration alone does NOT
 * prevent this: `ENTRY_END - startTime` is strictly positive for an open entry either way, so
 * a `> 0` test cannot tell the two apart. The clamp bounds the MAGNITUDE; this predicate
 * decides CANDIDACY. Both are needed — neither substitutes for the other.
 *
 * Self-parenthesised: it is an `OR`, and the `FILTER (WHERE …)` it sits in today supplies its own
 * delimiters — but dropped into a `WHERE` beside an `AND` the precedence would silently invert.
 */
const IS_EVIDENCE = (freshnessSeconds: number): Prisma.Sql => Prisma.sql`
  (te."endTime" IS NOT NULL
   OR COALESCE(te."heartbeatAt", te."startTime") + make_interval(secs => ${freshnessSeconds}) >= now())`;

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
  freshnessSeconds: number,
  lookbackWeeks = LOOKBACK_WEEKS,
): Promise<number> {
  // Candidate (userId, weekStart) pairs: active users with >0 tracked seconds of EVIDENCE (see
  // IS_EVIDENCE) for entries STARTING within a closed in-window week. A SUM over an empty FILTER
  // is NULL, and `NULL > 0` is not true — so a week whose every entry is stranded drops out.
  // weekStart/currentWeekStart are UTC Monday instants.
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
    HAVING SUM(EXTRACT(EPOCH FROM (${ENTRY_END(freshnessSeconds)} - te."startTime")))
             FILTER (WHERE ${IS_EVIDENCE(freshnessSeconds)}) > 0
  `;

  if (candidates.length === 0) return 0;

  const data = candidates.map((c) => {
    const periodStart = new Date(c.periodStart); // pg may hand back Date OR string
    return { userId: c.userId, periodStart, periodEnd: new Date(periodStart.getTime() + WEEK_MS) };
  });

  const res = await prisma.timesheetApproval.createMany({ data, skipDuplicates: true });
  return res.count;
}
