import { Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { APP_TIMEZONE } from '@timetrack/contracts';
import type { Project, Task } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * The effective end of a time entry. A CLOSED entry ends at its `endTime`. An OPEN entry ends
 * at whichever comes first: now, or its last heartbeat plus the freshness window — so a client
 * that has stopped heartbeating (crash, sleep, shutdown) stops accruing duration instead of
 * growing without bound (spec §4.3).
 *
 * Rows written before `heartbeatAt` existed have null, and fall back to `startTime`.
 *
 * Mirrors the canonical `ENTRY_END` in `reports.repository.ts`. The project detail page and
 * `/reports` read the SAME entries, so an unclamped total here meant one stranded entry showed
 * two different numbers on two pages.
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

const PROJECT_SELECT = {
  id: true,
  teamId: true,
  name: true,
  color: true,
  archived: true,
} as const;

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByTeam(teamId: string, includeArchived = false): Promise<Project[]> {
    // One query, not N+1 (CLAUDE.md §4) — tasks come back via the nested select.
    const rows = await this.prisma.project.findMany({
      where: { teamId, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { name: 'asc' },
      select: {
        ...PROJECT_SELECT,
        tasks: {
          where: { archived: false },
          select: { id: true, projectId: true, name: true, archived: true },
        },
      },
    });
    return rows;
  }

  async createProject(
    teamId: string,
    name: string,
    actorId: string,
    color: string | null = null,
  ): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { teamId, name, color },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.create',
          targetType: 'project',
          targetId: project.id,
          diff: { teamId, name, color },
        },
      });
      return project;
    });
  }

  async createTask(projectId: string, name: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: { projectId, name },
        select: { id: true, projectId: true, name: true, archived: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'task.create',
          targetType: 'task',
          targetId: task.id,
          diff: { projectId, name },
        },
      });
      return task;
    });
  }

  listTasksForProject(projectId: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
      select: { id: true, projectId: true, name: true, archived: true },
    });
  }

  async findTaskForActor(taskId: string): Promise<{ projectId: string; teamId: string } | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true, project: { select: { teamId: true } } },
    });
    return task ? { projectId: task.projectId, teamId: task.project.teamId } : null;
  }

  async setTaskArchived(id: string, archived: boolean, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: { archived },
        select: { id: true, projectId: true, name: true, archived: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: archived ? 'task.archive' : 'task.unarchive',
          targetType: 'task',
          targetId: id,
          diff: { archived },
        },
      });
      return task;
    });
  }

  /**
   * Move a project to another team and audit it in the same transaction, mirroring
   * `user.team_change`. Tasks follow by FK; time entries are deliberately left alone — they
   * reference the project by id and reports scope by the entry's user, so hours already
   * tracked stay with the team whose people tracked them.
   */
  async setTeam(id: string, teamId: string, actorId: string): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.project.findUnique({ where: { id }, select: { teamId: true } });
      const project = await tx.project.update({
        where: { id },
        data: { teamId },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.team_change',
          targetType: 'project',
          targetId: id,
          diff: { from: before?.teamId ?? null, to: teamId },
        },
      });
      return project;
    });
  }

  findForActor(id: string): Promise<{
    id: string;
    teamId: string;
    name: string;
    color: string | null;
    archived: boolean;
  } | null> {
    return this.prisma.project.findUnique({
      where: { id },
      select: { id: true, teamId: true, name: true, color: true, archived: true },
    });
  }

  async hoursByDay(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ day: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; trackedSeconds: number | bigint }>
    >`
      SELECT to_char(GREATEST(te."startTime", ${from}::timestamptz) AT TIME ZONE ${APP_TIMEZONE}::text, 'YYYY-MM-DD') AS "day",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({ day: r.day, trackedSeconds: Number(r.trackedSeconds) }));
  }

  async membersForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ userId: string; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."userId" AS "userId", u.name AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      JOIN users u ON u.id = te."userId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY te."userId", u.name
      ORDER BY "trackedSeconds" DESC, u.name ASC
    `;
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }

  async tasksForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ taskId: string | null; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ taskId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."taskId" AS "taskId", COALESCE(t.name, 'No task') AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN tasks t ON t.id = te."taskId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY te."taskId", t.name
      ORDER BY "trackedSeconds" DESC, "taskId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      taskId: r.taskId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }

  /**
   * Per-app breakdown of activity_samples covered by this project's time entries, plus the
   * project's total tracked seconds in the same window. Uses an EXISTS semi-join (not a plain
   * JOIN): a plain JOIN would count a sample once per containing entry, so two overlapping
   * same-project entries for one user (nothing forbids overlap; only one-running-per-user is
   * enforced) would double-count that sample's minute — inflating coveredSeconds past
   * totalSeconds and coveragePct past 100%. EXISTS counts each sample at most once and keeps
   * a."timestamp" on the outer scan so partition pruning still applies.
   */
  async topAppsForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ apps: { appName: string; trackedSeconds: number }[]; totalSeconds: number }> {
    const appRows = await this.prisma.$queryRaw<
      Array<{ appName: string; trackedSeconds: number | bigint }>
    >`
      SELECT a."appName" AS "appName", COUNT(*) * 60 AS "trackedSeconds"
      FROM activity_samples a
      WHERE a."timestamp" >= ${from}::timestamptz
        AND a."timestamp" <  ${to}::timestamptz
        AND EXISTS (
          SELECT 1 FROM time_entries te
          WHERE te."projectId" = ${projectId}
            AND te."userId" = a."userId"
            AND a."timestamp" >= te."startTime"
            AND a."timestamp" <  ${ENTRY_END(freshnessSeconds)}
        )
      GROUP BY a."appName"
      ORDER BY "trackedSeconds" DESC, a."appName" ASC
    `;

    const totalRows = await this.prisma.$queryRaw<
      Array<{ trackedSeconds: number | bigint | null }>
    >`
      SELECT FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
    `;

    return {
      apps: appRows.map((r) => ({ appName: r.appName, trackedSeconds: Number(r.trackedSeconds) })),
      totalSeconds: Number(totalRows[0]?.trackedSeconds ?? 0),
    };
  }

  async setArchived(id: string, archived: boolean, actorId: string): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: { archived },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: archived ? 'project.archive' : 'project.unarchive',
          targetType: 'project',
          targetId: id,
          diff: { archived },
        },
      });
      return project;
    });
  }

  async setColor(id: string, color: string, actorId: string): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: { color },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.recolor',
          targetType: 'project',
          targetId: id,
          diff: { color },
        },
      });
      return project;
    });
  }
}
