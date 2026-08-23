import { Prisma, type PrismaClient } from '@timetrack/db';
import { APP_TIMEZONE, dayOf, dayStartInstant, shiftDay } from '@timetrack/contracts';

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
 * `periodStart` is derived with `date_trunc('week', ts AT TIME ZONE $tz) AT TIME ZONE $tz`
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
  // weekStart/currentWeekStart are APP_TIMEZONE Monday instants — the SAME boundary the
  // dashboard and `/reports` use (`weekStartDay` + `dayStartInstant`). Anchoring these to UTC
  // instead put the approval week 6h out of step with every other week in the product, so
  // early-Monday work fell into the previous week's timesheet and no total could reconcile.
  const candidates = await prisma.$queryRaw<Array<{ userId: string; periodStart: Date | string }>>`
    WITH bounds AS (
      SELECT ((date_trunc('week', ${now}::timestamptz AT TIME ZONE ${APP_TIMEZONE}::text)
               AT TIME ZONE ${APP_TIMEZONE}::text) AT TIME ZONE 'UTC') AS current_week_start
    ),
    -- The 'UTC' hops are the column's STORAGE convention, not the org zone: Prisma maps
    -- DateTime to a "timestamp without time zone" holding UTC, so the value must be lifted
    -- to an instant before it can be read in APP_TIMEZONE, and lowered back after. Dropping
    -- either hop truncates the week in the session zone and lands 6h out (verified: a
    -- 2026-07-05T20:00Z entry then reports the week of 06-29 instead of 07-06).
    --
    -- The week expression is computed ONCE here and referenced as a plain column below.
    -- Repeating it inline in SELECT/WHERE/GROUP BY does not work: Prisma emits a separate
    -- positional parameter per interpolation, so the zone placeholder in GROUP BY is a
    -- different node from the one in SELECT and Postgres rejects it (42803) rather than
    -- recognising the two as the same expression.
    scoped AS (
      SELECT e."userId", e."startTime", e."endTime", e."heartbeatAt",
             ((date_trunc('week', e."startTime" AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TIMEZONE}::text)
               AT TIME ZONE ${APP_TIMEZONE}::text) AT TIME ZONE 'UTC') AS week_start
      FROM time_entries e
      JOIN users u ON u.id = e."userId" AND u."deactivatedAt" IS NULL
    )
    SELECT te."userId" AS "userId", te.week_start AS "periodStart"
    FROM scoped te
    CROSS JOIN bounds b
    WHERE te.week_start >= b.current_week_start - make_interval(weeks => ${lookbackWeeks})
      AND te.week_start < b.current_week_start
    GROUP BY te."userId", te.week_start
    HAVING SUM(EXTRACT(EPOCH FROM (${ENTRY_END(freshnessSeconds)} - te."startTime")))
             FILTER (WHERE ${IS_EVIDENCE(freshnessSeconds)}) > 0
  `;

  if (candidates.length === 0) return 0;

  const data = candidates.map((c) => {
    const periodStart = new Date(c.periodStart); // pg may hand back Date OR string
    // periodEnd via the calendar helpers rather than +7×24h: under a zone that observes DST a
    // week is not always 168 hours, and these must stay the exact instants `dayStartInstant`
    // produces so the period lines up with the reports week to the millisecond.
    return {
      userId: c.userId,
      periodStart,
      periodEnd: dayStartInstant(shiftDay(dayOf(periodStart), 7)),
    };
  });

  const res = await prisma.timesheetApproval.createMany({ data, skipDuplicates: true });
  return res.count;
}
