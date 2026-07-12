import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface OverviewRow {
  userId: string;
  name: string;
  tracking: boolean;
  trackedSecondsToday: number;
}

/**
 * CLAUDE.md §3 — Prisma lives HERE. The overview aggregate is ONE raw query: Prisma
 * `groupBy` cannot express the interval clamp (a running entry uses now(); an entry that
 * crosses the window boundary is trimmed to it). Starting from `users` and LEFT JOINing
 * time_entries keeps zero-entry members in the result.
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
      WHERE ${scope}
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
}
