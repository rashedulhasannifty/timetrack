import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@timetrack/db';
import { APP_TIMEZONE, DEFAULT_SUBPROJECT_NAME } from '@timetrack/contracts';
import type { Project, Subproject, Task } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  CONCURRENT_CHANGE,
  RECONCILE_TX,
  WorkTypesRepository,
  catalogConflict,
  isUniqueViolation,
} from '../work-types/work-types.repository.js';

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

const TASK_SELECT = {
  id: true,
  projectId: true,
  subprojectId: true,
  name: true,
  archived: true,
} as const;

const SUBPROJECT_SELECT = {
  id: true,
  projectId: true,
  name: true,
  archived: true,
  isDefault: true,
} as const;

/** CLAUDE.md §3 — Prisma lives here. Never select `*` back to the client. */
@Injectable()
export class ProjectsRepository {
  // Both params carry explicit tokens: once any param has @Inject, Nest stops reflecting the
  // others, and vitest's transform drops design:paramtypes (see projects.service.ts).
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkTypesRepository) private readonly workTypes: WorkTypesRepository,
  ) {}

  async listByTeam(teamId: string, includeArchived = false): Promise<Project[]> {
    // One query, not N+1 (CLAUDE.md §4) — tasks come back via the nested select.
    const rows = await this.prisma.project.findMany({
      where: { teamId, ...(includeArchived ? {} : { archived: false }) },
      orderBy: { name: 'asc' },
      select: {
        ...PROJECT_SELECT,
        subprojects: {
          where: includeArchived ? {} : { archived: false },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
          select: SUBPROJECT_SELECT,
        },
        // Assignable tasks only. A task in an ARCHIVED subproject is not assignable either — this
        // nested list is what the shipped clients pick from, so it is the only way archiving a
        // subproject reaches them.
        tasks: {
          where: { archived: false, subproject: { archived: false } },
          select: TASK_SELECT,
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
      // Every project owns exactly one default subproject (partial unique index), created with it.
      await tx.subproject.create({
        data: { projectId: project.id, name: DEFAULT_SUBPROJECT_NAME, isDefault: true },
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
      // The team's work types, in the same transaction (spec §5): a manager who creates a client
      // still gets them. One project, so Prisma's default transaction timeout is enough (R13).
      await this.workTypes.reconcile(tx, [project.id], {
        actorId,
        trigger: 'project_create',
        targetType: 'project',
        targetId: project.id,
      });
      return project;
    });
  }

  findTeam(teamId: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true, name: true } });
  }

  /** Every project name in the org, with its team's name — the import's org-wide duplicate check. */
  async listAllProjectNames(): Promise<{ name: string; teamName: string }[]> {
    const rows = await this.prisma.project.findMany({
      orderBy: { name: 'asc' },
      select: { name: true, team: { select: { name: true } } },
    });
    return rows.map((r) => ({ name: r.name, teamName: r.team.name }));
  }

  /**
   * The client import (spec §6): every project, its General default, a `project.create` audit row
   * each, and one reconcile for the lot — all in ONE transaction, with the long timeout (R13).
   */
  async createProjectsBulk(
    teamId: string,
    items: readonly { name: string; color: string }[],
    actorId: string,
  ): Promise<Project[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const projects = await tx.project.createManyAndReturn({
          data: items.map((i) => ({ teamId, name: i.name, color: i.color })),
          select: PROJECT_SELECT,
        });
        await tx.subproject.createMany({
          data: projects.map((p) => ({
            projectId: p.id,
            name: DEFAULT_SUBPROJECT_NAME,
            isDefault: true,
          })),
        });
        await tx.auditLog.createMany({
          data: projects.map((p) => ({
            actorId,
            action: 'project.create',
            targetType: 'project',
            targetId: p.id,
            diff: { teamId, name: p.name, color: p.color },
          })),
        });
        await this.workTypes.reconcile(
          tx,
          projects.map((p) => p.id),
          { actorId, trigger: 'project_bulk_create', targetType: 'team', targetId: teamId },
        );
        return projects;
      }, RECONCILE_TX);
    } catch (e) {
      if (isUniqueViolation(e)) throw catalogConflict(CONCURRENT_CHANGE);
      throw e;
    }
  }

  async createTask(subprojectId: string, name: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.findUniqueOrThrow({
        where: { id: subprojectId },
        select: { projectId: true },
      });
      const task = await tx.task.create({
        data: { projectId: sub.projectId, subprojectId, name },
        select: TASK_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'task.create',
          targetType: 'task',
          targetId: task.id,
          diff: { projectId: sub.projectId, subprojectId, name },
        },
      });
      return task;
    });
  }

  listTasksForProject(projectId: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ archived: 'asc' }, { name: 'asc' }],
      select: TASK_SELECT,
    });
  }

  async findTaskForActor(taskId: string): Promise<(Task & { teamId: string }) | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { ...TASK_SELECT, project: { select: { teamId: true } } },
    });
    if (!task) return null;
    const { project, ...rest } = task;
    return { ...rest, teamId: project.teamId };
  }

  async moveTask(taskId: string, subprojectId: string, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: { subprojectId: true },
      });
      const task = await tx.task.update({
        where: { id: taskId },
        data: { subprojectId },
        select: TASK_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'task.move',
          targetType: 'task',
          targetId: taskId,
          diff: { from: before.subprojectId, to: subprojectId },
        },
      });
      return task;
    });
  }

  async createSubproject(projectId: string, name: string, actorId: string): Promise<Subproject> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.create({
        data: { projectId, name },
        select: SUBPROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'subproject.create',
          targetType: 'subproject',
          targetId: sub.id,
          diff: { projectId, name },
        },
      });
      return sub;
    });
  }

  async updateSubproject(
    id: string,
    patch: { name?: string; archived?: boolean },
    actorId: string,
  ): Promise<Subproject> {
    return this.prisma.$transaction(async (tx) => {
      const sub = await tx.subproject.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
        },
        select: SUBPROJECT_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'subproject.update',
          targetType: 'subproject',
          targetId: id,
          diff: { ...patch },
        },
      });
      return sub;
    });
  }

  /**
   * `workTypeId` rides along for the service's "managed by the catalog" check ONLY. It is never
   * added to SUBPROJECT_SELECT: that select feeds GET /v1/projects, which the shipped clients read.
   */
  async findSubprojectForActor(
    id: string,
  ): Promise<(Subproject & { teamId: string; workTypeId: string | null }) | null> {
    const sub = await this.prisma.subproject.findUnique({
      where: { id },
      select: { ...SUBPROJECT_SELECT, workTypeId: true, project: { select: { teamId: true } } },
    });
    if (!sub) return null;
    const { project, ...rest } = sub;
    return { ...rest, teamId: project.teamId };
  }

  async hasActiveSubprojectNamed(projectId: string, name: string): Promise<boolean> {
    const hit = await this.prisma.subproject.findFirst({
      where: { projectId, archived: false, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    return hit !== null;
  }

  listSubprojectsForProject(projectId: string): Promise<Subproject[]> {
    return this.prisma.subproject.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { archived: 'asc' }, { name: 'asc' }],
      select: SUBPROJECT_SELECT,
    });
  }

  async setTaskArchived(id: string, archived: boolean, actorId: string): Promise<Task> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: { archived },
        select: TASK_SELECT,
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
      // Swap to the new team's work types: the old team's linked rows archive (never delete) and
      // a move back restores the same rows (spec §5, rule 1 and 4).
      await this.workTypes.reconcile(tx, [id], {
        actorId,
        trigger: 'project_team_change',
        targetType: 'project',
        targetId: id,
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
  ): Promise<
    { taskId: string | null; subprojectId: string | null; name: string; trackedSeconds: number }[]
  > {
    const rows = await this.prisma.$queryRaw<
      Array<{
        taskId: string | null;
        subprojectId: string | null;
        name: string;
        trackedSeconds: number | bigint;
      }>
    >`
      SELECT te."taskId" AS "taskId", t."subprojectId" AS "subprojectId",
             COALESCE(t.name, 'No task') AS "name",
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
      GROUP BY te."taskId", t."subprojectId", t.name
      ORDER BY "trackedSeconds" DESC, "taskId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      taskId: r.taskId,
      subprojectId: r.subprojectId,
      name: r.name,
      trackedSeconds: Number(r.trackedSeconds),
    }));
  }

  async subprojectsForProject(
    projectId: string,
    from: Date,
    to: Date,
    freshnessSeconds: number,
  ): Promise<{ subprojectId: string | null; name: string; trackedSeconds: number }[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ subprojectId: string | null; name: string; trackedSeconds: number | bigint }>
    >`
      SELECT te."subprojectId" AS "subprojectId", COALESCE(s.name, 'No subproject') AS "name",
             FLOOR(SUM(GREATEST(EXTRACT(EPOCH FROM (
               LEAST(${ENTRY_END(freshnessSeconds)}, ${to}::timestamptz)
               - GREATEST(te."startTime", ${from}::timestamptz)
             )), 0)))::int AS "trackedSeconds"
      FROM time_entries te
      LEFT JOIN subprojects s ON s.id = te."subprojectId"
      WHERE te."projectId" = ${projectId}
        AND te."startTime" < ${to}::timestamptz
        AND ${ENTRY_END(freshnessSeconds)} > ${from}::timestamptz
        AND (te."endTime" IS NULL OR te."endTime" > te."startTime")
      GROUP BY te."subprojectId", s.name
      ORDER BY "trackedSeconds" DESC, "subprojectId" ASC NULLS LAST
    `;
    return rows.map((r) => ({
      subprojectId: r.subprojectId,
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
