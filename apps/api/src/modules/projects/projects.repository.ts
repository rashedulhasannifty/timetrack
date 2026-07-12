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

  findForActor(id: string): Promise<{ id: string; teamId: string; archived: boolean } | null> {
    return this.prisma.project.findUnique({
      where: { id },
      select: { id: true, teamId: true, archived: true },
    });
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
