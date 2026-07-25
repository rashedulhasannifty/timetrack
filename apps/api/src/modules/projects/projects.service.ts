import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProject,
  CreateTask,
  Project,
  ProjectDetail,
  ProjectDetailQuery,
  Task,
  UpdateProject,
} from '@timetrack/contracts';
import { ProjectDetailSchema } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ProjectsRepository } from './projects.repository.js';

/**
 * CLAUDE.md §4 — own-team-only for BOTH MANAGER and ADMIN (the `setActive` precedent).
 * Projects are team-scoped, not user-scoped, so there is no `@ResourceScope`; the rule
 * lives here. Cross-team existing resource → 403; missing → 404.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly repo: ProjectsRepository) {}

  list(user: SessionUser, includeArchived = false): Promise<Project[]> {
    return this.repo.listByTeam(user.teamId, includeArchived);
  }

  async createProject(dto: CreateProject, actor: SessionUser): Promise<Project> {
    if (dto.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.createProject(dto.teamId, dto.name, actor.id);
  }

  async createTask(dto: CreateTask, actor: SessionUser): Promise<Task> {
    const project = await this.repo.findForActor(dto.projectId);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.createTask(dto.projectId, dto.name, actor.id);
  }

  async archive(id: string, dto: UpdateProject, actor: SessionUser): Promise<Project> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();
    return this.repo.setArchived(id, dto.archived, actor.id);
  }

  async detail(id: string, query: ProjectDetailQuery, actor: SessionUser): Promise<ProjectDetail> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    if (project.teamId !== actor.teamId) throw this.forbidden();

    const from = new Date(query.from);
    const to = new Date(query.to);
    const [trend, members, tasks] = await Promise.all([
      this.repo.hoursByDay(id, from, to),
      this.repo.membersForProject(id, from, to),
      this.repo.tasksForProject(id, from, to),
    ]);
    const totalSeconds = members.reduce((sum, m) => sum + m.trackedSeconds, 0);

    // Re-validate on the way out (mirrors ReportsService); parse also strips any surprises.
    return ProjectDetailSchema.parse({
      from: query.from,
      to: query.to,
      projectId: id,
      name: project.name,
      archived: project.archived,
      totalSeconds,
      trend,
      members,
      tasks,
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      type: 'https://timetrack.internal/errors/forbidden',
      title: 'Cannot manage a project in another team',
      status: 403,
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      type: 'https://timetrack.internal/errors/not-found',
      title: 'Project not found',
      status: 404,
    });
  }
}
