import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

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
 * CLAUDE.md §3 — Prisma lives HERE. The overview aggregate is ONE raw query: Prisma
 * `groupBy` cannot express the interval clamp (a running entry uses now(); an entry that
 * crosses the window boundary is trimmed to it). Starting from `users` and LEFT JOINing
 * time_entries keeps zero-entry members in the result. Deactivated users are excluded so
 * ex-employees don't show up in "who's tracking today."
 */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  overviewForTeam(teamId: string, dayStart: Date, dayEnd: Date): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u."teamId" = ${teamId}`, dayStart, dayEnd);
  }

  overviewForSelf(userId: string, dayStart: Date, dayEnd: Date): Promise<OverviewRow[]> {
    return this.overview(Prisma.sql`u.id = ${userId}`, dayStart, dayEnd);
  }

  private async overview(scope: Prisma.Sql, dayStart: Date, dayEnd: Date): Promise<OverviewRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; name: string; tracking: boolean; trackedSeconds: number | bigint }>
    >`
      SELECT
        u.id AS "userId",
        u.name AS "name",
        COALESCE(bool_or(te.id IS NOT NULL AND te."endTime" IS NULL), false) AS "tracking",
        COALESCE(FLOOR(SUM(
          CASE WHEN te.id IS NULL THEN 0
               ELSE GREATEST(
                 EXTRACT(EPOCH FROM (
                   LEAST(COALESCE(te."endTime", now()), ${dayEnd}::timestamptz)
                   - GREATEST(te."startTime", ${dayStart}::timestamptz)
                 )),
                 0
               )
          END
        )), 0)::int AS "trackedSeconds"
      FROM users u
      LEFT JOIN time_entries te
        ON te."userId" = u.id
        AND te."startTime" < ${dayEnd}::timestamptz
        AND COALESCE(te."endTime", now()) > ${dayStart}::timestamptz
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
  async teamSummary(scope: ReportScope, from: Date, to: Date): Promise<TeamSummaryRepoRow[]> {
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
               FLOOR(SUM(GREATEST(
                 EXTRACT(EPOCH FROM (
                   LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
                   - GREATEST(te."startTime", ${from}::timestamptz)
                 )), 0
               )))::int AS "trackedSeconds"
        FROM time_entries te
        WHERE te."startTime" < ${to}::timestamptz
          AND COALESCE(te."endTime", now()) > ${from}::timestamptz
        GROUP BY te."userId"
      ),
      activity AS (
        SELECT ads."userId",
               ROUND(
                 SUM(ads."avgActivityPct"::numeric * ads."activeMinutes")
                 / NULLIF(SUM(ads."activeMinutes"), 0)
               )::int AS "activityPct"
        FROM activity_daily_summaries ads
        WHERE ads."day" BETWEEN (${from}::timestamptz)::date AND (${to}::timestamptz)::date
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
                 LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
                 - GREATEST(te."startTime", ${from}::timestamptz)
               )), 0
             )))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN projects p ON p.id = te."projectId"
      WHERE te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
        AND (${this.scopeSql(scope, Prisma.sql`te."userId"`)})
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
}
