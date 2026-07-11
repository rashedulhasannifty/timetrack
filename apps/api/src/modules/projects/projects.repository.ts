import { Injectable } from '@nestjs/common';
import type { Project } from '@timetrack/contracts';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listByTeam(teamId: string): Promise<Project[]> {
    // One query, not N+1 (CLAUDE.md §4) — tasks come back via include.
    const rows = await this.prisma.project.findMany({
      where: { teamId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        teamId: true,
        name: true,
        archived: true,
        tasks: { select: { id: true, projectId: true, name: true } },
      },
    });
    return rows;
  }

  // TODO(scaffold): createProject(teamId, name) / createTask(projectId, name).
}
