import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { APP_TIMEZONE } from '@timetrack/contracts';
import type { TeamTrendDay, TeamActivityRow, TeamAppUsageRow } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { CsvEntryRow } from './csv-writer.js';

export interface OverviewRow {
  userId: string;
  name: string;
  tracking: boolean;
  trackedSecondsToday: number;
}

export type ReportScope =
  { kind: 'team'; teamId: string } | { kind: 'user'; userId: string } | { kind: 'all' };

export interface TeamSummaryRepoRow {
  userId: string;
  name: string;
  trackedSeconds: number;
  activityPct: number;
}

export interface ProjectSummaryRepoRow {
  projectId: string | null;
  name: string;
  trackedSeconds: number;
}

/**
 * The effective end of a time entry. A CLOSED entry ends at its `endTime`. An OPEN entry ends
 * at whichever comes first: now, or its last heartbeat plus the freshness window — so a client
 * that has stopped heartbeating (crash, sleep, shutdown) stops accruing duration instead of
 * growing without bound (spec §4.3).
 *
 * Rows written before `heartbeatAt` existed have null, and fall back to `startTime`.
 *
 * Assumes the `time_entries` table is aliased `te` in the surrounding query.
 *
 * NOTE: `approvals.repository.ts` now defines the same clamp locally (the two apps/modules
 * cannot share a Prisma.Sql fragment across the module boundary). It used to bound an open
 * entry only by the approval period, which let one stranded row inflate a week a manager was
 * about to sign off. Change one, change the other.
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
 * Seconds covered by a multirange of tracked spans, counting overlapping time ONCE.
 *
 * A plain SUM of per-entry durations double-counts: two entries covering 09:00–13:00 and
 * 11:00–15:00 sum to 8h for a person who worked 6h. The dashboard's person-day view has always
 * coalesced its intervals before totalling (`person-day-view.ts`), so the same day read 8h on
 * Overview and 6h on the person page. `range_agg` does the union in the database, so every
 * tracked-time total in the product now means the same thing: wall-clock time covered.
 *
 * Overlap is reachable from an edit (refused since C4) and from one account tracking on two
 * Macs — the one-running-per-user index only stops two concurrently OPEN entries, so both
 * machines' CLOSED rows upsert happily.
 *
 * `range_agg` over no rows is NULL; `unnest(NULL)` yields no rows, so the COALESCE returns 0.
 */
const MERGED_SECONDS = (multirange: Prisma.Sql): Prisma.Sql => Prisma.sql`
  COALESCE((
    SELECT SUM(EXTRACT(EPOCH FROM (upper(x) - lower(x))))
    FROM unnest(${multirange}) AS x
  ), 0)`;

/**
 * One entry's tracked span, clipped to [from, to). Empty (and dropped by range_agg) when the
 * entry does not actually intersect the window.
 */
const CLIPPED_SPAN = (from: Prisma.Sql, to: Prisma.Sql, freshnessSeconds: number): Prisma.Sql =>
  Prisma.sql`
  tstzrange(
    GREATEST(te."startTime", ${from}),
    GREATEST(LEAST(${ENTRY_END(freshnessSeconds)}, ${to}), GREATEST(te."startTime", ${from}))
  )`;

/**
 * CLAUDE.md §3 — Prisma lives HERE. The overview aggregate is ONE raw query: Prisma
 * `groupBy` cannot express the interval clamp (a running entry uses now(); an entry that
 * crosses the window boundary is trimmed to it). Starting from `users` and LEFT JOINing
 * time_entries keeps zero-entry members in the result. Deactivated users are excluded so
 * ex-employees don't show up in "who's tracking today."
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  overviewForTeam(
    teamId: string,
    dayStart: Date,
    dayEnd: Date,
    freshnessSeconds: number,
  ): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u."teamId" = ${teamId}`, dayStart, dayEnd, freshnessSeconds);
  }

  overviewForSelf(
    userId: string,
    dayStart: Date,
    dayEnd: Date,
    freshnessSeconds: number,
  ): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u.id = ${userId}`, dayStart, dayEnd, freshnessSeconds);
  }

  /**
   * "Tracking now" is an OPEN entry that is still proving it is alive — the same predicate
   * `ENTRY_END` clamps with, so the pill and the tracked seconds beside it can never disagree.
   *
   * It used to be activity-sample recency instead, because the client of the day uploaded a time
   * entry only on stop and never published a running one; a fresh sample was the only live signal
   * there was. The client now publishes the open entry and heartbeats it, so that reasoning is
   * obsolete — and it had become actively wrong, since samples and entries travel separate paths.
   * Seen in the wild: a stranded open row made every live publish 409 while samples kept flowing,
   * so the dashboard showed someone as "tracking now" with their tracked time frozen for hours.
   * Two sources, two answers, no way to tell which was right.
   */
  private async overview(
    scope: Prisma.Sql,
    dayStart: Date,
    dayEnd: Date,
    freshnessSeconds: number,
  ): Promise<OverviewRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; name: string; tracking: boolean; trackedSeconds: number | bigint }>
    >`
      SELECT
        u.id AS "userId",
        u.name AS "name",
        EXISTS (
          SELECT 1 FROM time_entries t
          WHERE t."userId" = u.id
            AND t."endTime" IS NULL
            AND COALESCE(t."heartbeatAt", t."startTime")
                > now() - make_interval(secs => ${freshnessSeconds})
        ) AS "tracking",
        FLOOR(${MERGED_SECONDS(
          Prisma.sql`range_agg(${CLIPPED_SPAN(Prisma.sql`${dayStart}::timestamptz`, Prisma.sql`${dayEnd}::timestamptz`, freshnessSeconds)}) FILTER (WHERE te.id IS NOT NULL)`,
        )})::int AS "trackedSeconds"
      FROM users u
      LEFT JOIN time_entries te
        ON te."userId" = u.id
        AND te."startTime" < ${dayEnd}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${dayStart}::timestamptz
      WHERE (${scope}) AND u."deactivatedAt" IS NULL
      GROUP BY u.id, u.name
      ORDER BY u.name ASC
    `;
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      tracking: r.tracking,
      trackedSecondsToday: Number(r.trackedSeconds),
    }));
  }

  /**
   * A WHERE fragment restricting `<col>` (a userId-bearing column) to the actor's scope.
   * `all` → TRUE (ADMIN, no filter). The service resolves + authorizes the scope (CLAUDE.md §4);
   * the repo only translates it to SQL.
   */
  private scopeSql(scope: ReportScope, col: Prisma.Sql): Prisma.Sql {
    switch (scope.kind) {
      case 'user':
        return Prisma.sql`${col} = ${scope.userId}`;
      case 'team':
        return Prisma.sql`${col} IN (SELECT id FROM users WHERE "teamId" = ${scope.teamId})`;
      case 'all':
        return Prisma.sql`TRUE`;
    }
  }

  /**
   * Fan-out-safe team summary: `time_entries` and `activity_daily_summaries` are both
   * one-to-many on userId, so a naive double LEFT JOIN would Cartesian-product them and
   * inflate both trackedSeconds and activityPct. Each source is aggregated in its own CTE
   * keyed by userId first, and only those pre-aggregated single rows-per-user are joined
   * onto the scoped user set.
   */
  /**
   * Total tracked seconds for ONE user across an arbitrary range. Same overlap arithmetic as
   * every other tracked-time sum here: an entry is clipped to the range, and an open entry ends
   * at the clamped `ENTRY_END` so a client that stopped heartbeating cannot accrue time forever.
   *
   * Called once per range rather than folded into one query with conditional aggregates: the
   * week and month ranges OVERLAP without nesting (a Monday-start week can begin in the previous
   * month), so the clever version needs per-range clamping repeated three times over — more
   * surface for an off-by-one than three obviously-correct scans of an indexed range.
   */
  async trackedSecondsForUser(
    userId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ trackedSeconds: number | bigint }>>`
      WITH merged AS (
        SELECT range_agg(${CLIPPED_SPAN(Prisma.sql`${from}::timestamptz`, Prisma.sql`${to}::timestamptz`, freshnessSeconds)}) AS mr
        FROM time_entries te
        WHERE te."userId" = ${userId}
          AND te."startTime" < ${to}::timestamptz
          AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
          AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      )
      SELECT FLOOR(${MERGED_SECONDS(Prisma.sql`m.mr`)})::int AS "trackedSeconds"
      FROM merged m
    `;
    return Number(rows[0]?.trackedSeconds ?? 0);
  }

  async teamSummary(
    scope: ReportScope,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<TeamSummaryRepoRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        name: string;
        trackedSeconds: number | bigint;
        activityPct: number | bigint;
      }>
    >`
      WITH durations AS (
        SELECT te."userId",
               FLOOR(${MERGED_SECONDS(
                 Prisma.sql`range_agg(${CLIPPED_SPAN(Prisma.sql`${from}::timestamptz`, Prisma.sql`${to}::timestamptz`, freshnessSeconds)})`,
               )})::int AS "trackedSeconds"
        FROM time_entries te
        WHERE te."startTime" < ${to}::timestamptz
          AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
          AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
        GROUP BY te."userId"
      ),
      activity AS (
        SELECT ads."userId",
               ROUND(
                 SUM(ads."avgActivityPct"::numeric * ads."activeMinutes")
                 / NULLIF(SUM(ads."activeMinutes"), 0)
               )::int AS "activityPct"
        FROM activity_daily_summaries ads
        WHERE ads."day" BETWEEN (${from} AT TIME ZONE ${APP_TIMEZONE}::text)::date AND (${to} AT TIME ZONE ${APP_TIMEZONE}::text)::date
        GROUP BY ads."userId"
      ),
      scoped AS (
        SELECT u.id, u.name
        FROM users u
        WHERE (${this.scopeSql(scope, Prisma.sql`u.id`)})
          AND (
            EXISTS (SELECT 1 FROM durations d WHERE d."userId" = u.id)
            OR EXISTS (SELECT 1 FROM activity a WHERE a."userId" = u.id)
          )
      )
      SELECT s.id AS "userId", s.name AS "name",
             COALESCE(d."trackedSeconds", 0) AS "trackedSeconds",
             COALESCE(a."activityPct", 0) AS "activityPct"
      FROM scoped s
      LEFT JOIN durations d ON d."userId" = s.id
      LEFT JOIN activity  a ON a."userId" = s.id
      ORDER BY s.name ASC
    `;
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
      activityPct: Number(r.activityPct),
    }));
  }

  /**
   * Single-source per-project aggregate. Null-projectId time (no project assigned) is
   * rolled into a single "No project" bucket via COALESCE + grouping on the raw projectId,
   * not filtered out — otherwise the reconciliation-to-total invariant would silently break.
   */
  async projects(
    scope: ReportScope,
    from: Date,
    to: Date,
    freshnessSeconds: number,
    projectId?: string,
  ): Promise<ProjectSummaryRepoRow[]> {
    const projectFilter = projectId ? Prisma.sql`AND te."projectId" = ${projectId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ projectId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."projectId" AS "projectId",
             COALESCE(p.name, 'No project') AS "name",
             FLOOR(SUM(GREATEST(
               EXTRACT(EPOCH FROM (
                 LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
                 - GREATEST(te."startTime", ${from}::timestamptz)
               )), 0
             )))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN projects p ON p.id = te."projectId"
      WHERE te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
        ${projectFilter}
      GROUP BY te."projectId", p.name
      ORDER BY "trackedSeconds" DESC, "projectId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      projectId: r.projectId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }

  /**
   * Daily trend series: one zero-filled row per calendar day in [from, to], with tracked
   * time (clamped/summed per day from time_entries) and category time (converted from
   * activity_daily_summaries' byCategory minutes to seconds). Both sources are aggregated
   * in their own CTE keyed by day before joining onto the `days` spine, for the same
   * fan-out-safety reason as `teamSummary`. Day boundaries are built as explicit
   * APP_TIMEZONE (`(d.day::timestamp) AT TIME ZONE ${APP_TIMEZONE}`) so the result doesn't
   * depend on session tz and buckets each instant onto its Dhaka calendar day.
   *
   * Range semantics differ from `teamSummary`/`projects`: here `to` is treated as an
   * INCLUSIVE calendar day (the `days` spine runs through `date(to)`), and each day's
   * tracked seconds are bucketed to Dhaka `[day, day+1)`, not clamped to the instant `to`.
   * Two consequences, both intended for the midnight-aligned ranges the dashboard sends:
   *   - the spine always includes `date(to)`, so a midnight-aligned `to` (e.g. `Aug 1 00:00`
   *     for "all of July") emits a trailing `date(to)` row whose in-range time is zero;
   *   - for a non-midnight-aligned `to`, the `date(to)` bucket counts the whole day past the
   *     instant `to`, so `Σ trends.days[].trackedSeconds` will NOT reconcile exactly with the
   *     instant-clamped `teamSummary.trackedSeconds` total.
   */
  async trends(
    scope: ReportScope,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<TeamTrendDay[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        day: string;
        trackedSeconds: number | bigint;
        productiveSeconds: number | bigint;
        neutralSeconds: number | bigint;
        unproductiveSeconds: number | bigint;
      }>
    >`
      WITH days AS (
        SELECT generate_series(
          (${from} AT TIME ZONE ${APP_TIMEZONE}::text)::date,
          (${to} AT TIME ZONE ${APP_TIMEZONE}::text)::date,
          interval '1 day'
        )::date AS day
      ),
      cat AS (
        SELECT ads."day" AS day,
               SUM(COALESCE((ads."byCategory"->>'PRODUCTIVE')::int, 0))   * 60 AS "productiveSeconds",
               SUM(COALESCE((ads."byCategory"->>'NEUTRAL')::int, 0))      * 60 AS "neutralSeconds",
               SUM(COALESCE((ads."byCategory"->>'UNPRODUCTIVE')::int, 0)) * 60 AS "unproductiveSeconds"
        FROM activity_daily_summaries ads
        WHERE ads."day" BETWEEN (${from} AT TIME ZONE ${APP_TIMEZONE}::text)::date AND (${to} AT TIME ZONE ${APP_TIMEZONE}::text)::date
          AND (${this.scopeSql(scope, Prisma.sql`ads."userId"`)})
        GROUP BY ads."day"
      ),
      -- Merged PER (day, user) and only then summed across the team: two people working the
      -- same hour are two tracked hours, but one person's two overlapping entries are one.
      per_user AS (
        SELECT d.day, te."userId",
               ${MERGED_SECONDS(
                 Prisma.sql`range_agg(${CLIPPED_SPAN(
                   Prisma.sql`(d.day::timestamp) AT TIME ZONE ${APP_TIMEZONE}::text`,
                   Prisma.sql`((d.day + 1)::timestamp) AT TIME ZONE ${APP_TIMEZONE}::text`,
                   freshnessSeconds,
                 )})`,
               )} AS secs
        FROM days d
        JOIN time_entries te
          ON te."startTime" < ((d.day + 1)::timestamp) AT TIME ZONE ${APP_TIMEZONE}::text
         AND ${ENTRY_END(freshnessSeconds)} > (d.day::timestamp) AT TIME ZONE ${APP_TIMEZONE}::text
         AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
         AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
        GROUP BY d.day, te."userId"
      ),
      tracked AS (
        SELECT day, FLOOR(SUM(secs))::int AS "trackedSeconds"
        FROM per_user
        GROUP BY day
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS "day",
             COALESCE(t."trackedSeconds", 0)       AS "trackedSeconds",
             COALESCE(c."productiveSeconds", 0)    AS "productiveSeconds",
             COALESCE(c."neutralSeconds", 0)       AS "neutralSeconds",
             COALESCE(c."unproductiveSeconds", 0)  AS "unproductiveSeconds"
      FROM days d
      LEFT JOIN cat     c ON c.day = d.day
      LEFT JOIN tracked t ON t.day = d.day
      ORDER BY d.day ASC
    `;
    return rows.map((r) => ({
      day: r.day,
      trackedSeconds: Number(r.trackedSeconds),
      productiveSeconds: Number(r.productiveSeconds),
      neutralSeconds: Number(r.neutralSeconds),
      unproductiveSeconds: Number(r.unproductiveSeconds),
    }));
  }

  /**
   * Per-person category + idle rollup. `cat` (activity_daily_summaries, keyed by day) and
   * `idle` (idle_events, an interval table) are each pre-aggregated to one row per userId
   * before joining onto the scoped user set — the same fan-out-safety reason as
   * `teamSummary`. Percentages divide by NULLIF(..., 0) so an all-zero denominator yields
   * NULL -> COALESCEd to 0 rather than dividing by zero. Idle duration is window-clamped
   * exactly like the time-entry clamps elsewhere in this file. The day-range filter is
   * built the same zone-pinned way as `trends` (`AT TIME ZONE ${APP_TIMEZONE}`, not a bare
   * `::timestamptz)::date` cast) so it doesn't depend on the session timezone; the idle
   * CTE's instant comparisons are already absolute and don't need that treatment.
   *
   * Mixed range semantics (same day-vs-instant nuance as `trends`, harmless for
   * midnight-aligned ranges): the `cat` CTE filters by an INCLUSIVE calendar day
   * (`ads."day" BETWEEN ...`), while the `idle` CTE filters by the instant `[from, to)`.
   */
  async teamActivity(scope: ReportScope, from: Date, to: Date): Promise<TeamActivityRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        name: string;
        activeMinutes: number | bigint;
        productivePct: number | bigint;
        neutralPct: number | bigint;
        unproductivePct: number | bigint;
        idleMinutes: number | bigint;
        idlePct: number | bigint;
      }>
    >`
      WITH cat AS (
        SELECT ads."userId" AS uid,
               SUM(ads."activeMinutes") AS active_min,
               SUM(COALESCE((ads."byCategory"->>'PRODUCTIVE')::int, 0))   AS prod,
               SUM(COALESCE((ads."byCategory"->>'NEUTRAL')::int, 0))      AS neut,
               SUM(COALESCE((ads."byCategory"->>'UNPRODUCTIVE')::int, 0)) AS unprod
        FROM activity_daily_summaries ads
        WHERE ads."day" BETWEEN (${from} AT TIME ZONE ${APP_TIMEZONE}::text)::date AND (${to} AT TIME ZONE ${APP_TIMEZONE}::text)::date
          AND (${this.scopeSql(scope, Prisma.sql`ads."userId"`)})
        GROUP BY ads."userId"
      ),
      idle AS (
        SELECT ie."userId" AS uid,
               FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
                 LEAST(ie."endTime", ${to}::timestamptz) - GREATEST(ie."startTime", ${from}::timestamptz)
               )), 0)) / 60)::int AS idle_min
        FROM idle_events ie
        WHERE ie."startTime" < ${to}::timestamptz
          AND ie."endTime" > ${from}::timestamptz
          AND (${this.scopeSql(scope, Prisma.sql`ie."userId"`)})
        GROUP BY ie."userId"
      ),
      scoped AS (
        SELECT u.id, u.name FROM users u
        WHERE (${this.scopeSql(scope, Prisma.sql`u.id`)})
          AND (EXISTS (SELECT 1 FROM cat WHERE uid = u.id) OR EXISTS (SELECT 1 FROM idle WHERE uid = u.id))
      )
      SELECT s.id AS "userId", s.name AS "name",
             COALESCE(c.active_min, 0)::int AS "activeMinutes",
             COALESCE(ROUND(c.prod::numeric   * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "productivePct",
             COALESCE(ROUND(c.neut::numeric   * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "neutralPct",
             COALESCE(ROUND(c.unprod::numeric * 100 / NULLIF(c.prod + c.neut + c.unprod, 0)), 0)::int AS "unproductivePct",
             COALESCE(i.idle_min, 0)::int AS "idleMinutes",
             COALESCE(ROUND(COALESCE(i.idle_min, 0)::numeric * 100 / NULLIF(COALESCE(c.active_min, 0) + COALESCE(i.idle_min, 0), 0)), 0)::int AS "idlePct"
      FROM scoped s
      LEFT JOIN cat  c ON c.uid = s.id
      LEFT JOIN idle i ON i.uid = s.id
      ORDER BY s.name ASC
    `;
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      activeMinutes: Number(r.activeMinutes),
      productivePct: Number(r.productivePct),
      neutralPct: Number(r.neutralPct),
      unproductivePct: Number(r.unproductivePct),
      idleMinutes: Number(r.idleMinutes),
      idlePct: Number(r.idlePct),
    }));
  }

  /**
   * Team-wide app/website breakdown from `activity_samples` (monthly-partitioned). Each
   * sample represents one polling tick (`ACTIVITY_SAMPLE_INTERVAL_SECONDS` = 60), so
   * `COUNT(*) * 60` converts sample counts to seconds — same convention as
   * `topAppsForProject` in projects.repository.ts. `per` pre-aggregates seconds per
   * (app, category); `totals` sums those into one row per app; `dominant` picks the
   * category with the most seconds per app via `DISTINCT ON`, tie-broken
   * `UNPRODUCTIVE > NEUTRAL > PRODUCTIVE` so a dead-even split doesn't read as falsely
   * productive.
   */
  async appUsage(
    scope: ReportScope,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<TeamAppUsageRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ appName: string; seconds: number | bigint; category: string }>
    >`
      WITH per AS (
        SELECT a."appName" AS app, a.category::text AS cat, COUNT(*) * 60 AS secs
        FROM activity_samples a
        WHERE a."timestamp" >= ${from}::timestamptz
          AND a."timestamp" <  ${to}::timestamptz
          AND (${this.scopeSql(scope, Prisma.sql`a."userId"`)})
        GROUP BY a."appName", a.category
      ),
      totals AS (
        SELECT app, SUM(secs)::int AS total FROM per GROUP BY app
      ),
      dominant AS (
        SELECT DISTINCT ON (app) app, cat
        FROM per
        ORDER BY app, secs DESC,
          CASE cat WHEN 'UNPRODUCTIVE' THEN 3 WHEN 'NEUTRAL' THEN 2 ELSE 1 END DESC
      )
      SELECT t.app AS "appName", t.total AS "seconds", d.cat AS "category"
      FROM totals t
      JOIN dominant d ON d.app = t.app
      ORDER BY t.total DESC, t.app ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      appName: r.appName,
      seconds: Number(r.seconds),
      category: r.category as TeamAppUsageRow['category'],
    }));
  }

  /**
   * Streams individual time entries for the CSV export (slice 3.2) via keyset pagination
   * on (startTime, id) — one bounded `$queryRaw` per batch, so the full set is never
   * buffered. Times are window-clamped AND truncated to whole seconds so each row
   * self-reconciles (end - start == durationSeconds) unconditionally — real client
   * timestamps are already whole-second, but the dashboard's `to` boundary can carry
   * milliseconds (e.g. end-of-day `T23:59:59.999Z`), and without truncating the clamped
   * edge a boundary-crossing entry's emitted endTime would retain the `.999` while
   * durationSeconds (FLOORed) would not, breaking the invariant. A running entry (endTime
   * NULL) yields a null endTime and a duration clamped via `ENTRY_END` — bounded by now(),
   * but by the last heartbeat plus the freshness window if the client has stopped
   * heartbeating (spec §4.3). `batchSize` exists so tests can force multi-batch
   * continuation; production uses the default.
   */
  async *streamEntries(
    scope: ReportScope,
    from: Date,
    to: Date,
    freshnessSeconds: number,
    projectId?: string,
    batchSize = 500,
  ): AsyncGenerator<CsvEntryRow> {
    // Named row shape (rather than an inline object type) so `rows`/`keyset`/`cursor` each
    // get an explicit annotation — without one, the mutual reassignment across `for(;;)`
    // iterations (cursor -> keyset -> rows -> cursor) is a genuine circular-inference cycle
    // (TS7022), not a spurious one.
    type StreamEntriesRow = {
      entryId: string;
      user: string;
      project: string | null;
      task: string | null;
      // pg may return computed timestamptz columns as Date OR ISO string — see the
      // defensive `new Date(...)` coercion below.
      seqStart: Date | string;
      startTime: Date | string;
      endTime: Date | string | null;
      durationSeconds: number | bigint;
      source: string;
      note: string | null;
    };

    const projectFilter = projectId ? Prisma.sql`AND te."projectId" = ${projectId}` : Prisma.empty;
    let cursor: { seqStart: Date | string; id: string } | null = null;

    for (;;) {
      const keyset: Prisma.Sql = cursor
        ? Prisma.sql`AND (te."startTime", te.id) > (${cursor.seqStart}::timestamptz, ${cursor.id})`
        : Prisma.empty;

      const rows: StreamEntriesRow[] = await this.prisma.$queryRaw<StreamEntriesRow[]>`
        SELECT te.id AS "entryId",
               u.name AS "user",
               p.name AS "project",
               t.name AS "task",
               te."startTime" AS "seqStart",
               date_trunc('second', GREATEST(te."startTime", ${from}::timestamptz)) AS "startTime",
               CASE WHEN te."endTime" IS NULL THEN NULL
                    ELSE date_trunc('second', LEAST(te."endTime", ${to}::timestamptz)) END AS "endTime",
               FLOOR(GREATEST(
                 EXTRACT(EPOCH FROM (
                   date_trunc('second', LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz))
                   - date_trunc('second', GREATEST(te."startTime", ${from}::timestamptz))
                 )), 0
               ))::int AS "durationSeconds",
               te.source::text AS "source",
               te.note AS "note"
        FROM time_entries te
        JOIN users u ON u.id = te."userId"
        LEFT JOIN projects p ON p.id = te."projectId"
        LEFT JOIN tasks t ON t.id = te."taskId"
        WHERE te."startTime" < ${to}::timestamptz
          AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
          AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
          AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
          ${projectFilter}
          ${keyset}
        ORDER BY te."startTime" ASC, te.id ASC
        LIMIT ${batchSize}
      `;

      for (const r of rows) {
        // Defensive coercion: the `$queryRaw<...>` annotation is an UNCHECKED cast, and
        // the pg driver may hand back computed `timestamptz` columns as strings, not Date
        // objects. `new Date(x)` is correct whether x is a Date or an ISO string, and keeps
        // `formatCsvRow(...).toISOString()` from throwing. Mirrors the repo's `Number(...)`
        // defensiveness on bigint/number columns elsewhere.
        yield {
          entryId: r.entryId,
          user: r.user,
          project: r.project,
          task: r.task,
          startTime: new Date(r.startTime),
          endTime: r.endTime == null ? null : new Date(r.endTime),
          durationSeconds: Number(r.durationSeconds),
          source: r.source,
          note: r.note,
        };
      }

      if (rows.length < batchSize) return;
      const last = rows[rows.length - 1]!;
      cursor = { seqStart: last.seqStart, id: last.entryId };
    }
  }
}
