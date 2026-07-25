import { Injectable } from '@nestjs/common';
import type { Project, Task } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const PROJECT_SELECT = {
  id: true,
  teamId: true,
  name: true,
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
        tasks: { select: { id: true, projectId: true, name: true } },
      },
    });
    return rows;
  }

  async createProject(teamId: string, name: string, actorId: string): Promise<Project> {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { teamId, name },
        select: PROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'project.create',
          targetType: 'project',
          targetId: project.id,
          diff: { teamId, name },
        },
      });
      return project;
    });
  }

  async createTask(projectId: string, name: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: { projectId, name },
        select: { id: true, projectId: true, name: true },
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

  findForActor(
    id: string,
  ): Promise<{ id: string; teamId: string; name: string; archived: boolean } | null> {
    return this.prisma.project.findUnique({
      where: { id },
      select: { id: true, teamId: true, name: true, archived: true },
    });
  }

  async hoursByDay(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<{ day: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: string; trackedSeconds: number | bigint }>
    >`
      SELECT to_char(GREATEST(te."startTime", ${from}::timestamptz) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "day",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({ day: r.day, trackedSeconds: Number(r.trackedSeconds) }));
  }

  async membersForProject(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<{ userId: string; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."userId" AS "userId", u.name AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      JOIN users u ON u.id = te."userId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
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
  ): Promise<{ taskId: string | null; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ taskId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."taskId" AS "taskId", COALESCE(t.name, 'No task') AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(COALESCE(te."endTime", now()), ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN tasks t ON t.id = te."taskId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND COALESCE(te."endTime", now()) > ${from}::timestamptz
      GROUP BY te."taskId", t.name
      ORDER BY "trackedSeconds" DESC, "taskId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      taskId: r.taskId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
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
}
