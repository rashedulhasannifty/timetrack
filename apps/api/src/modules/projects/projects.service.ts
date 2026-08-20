import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProject,
  CreateTask,
  Project,
  ProjectDetail,
  ProjectDetailQuery,
  ProjectTopApps,
  Task,
  UpdateProject,
  UpdateTask,
} from '@timetrack/contracts';
import { ProjectDetailSchema } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ProjectsRepository } from './projects.repository.js';
import { TRACKING_FRESHNESS_SECONDS } from './projects.tokens.js';

/**
 * CLAUDE.md §4 — own-team-only for BOTH MANAGER and ADMIN (the `setActive` precedent).
 * Projects are team-scoped, not user-scoped, so there is no `@ResourceScope`; the rule
 * lives here. Cross-team existing resource → 403; missing → 404.
 */
@Injectable()
export class ProjectsService {
  // BOTH params carry an explicit @Inject token, for the reason spelled out in
  // reports.service.ts: once Nest sees ANY explicit @Inject on the constructor it stops falling
  // back to type reflection for the others, and under this repo's vitest e2e transform (esbuild,
  // no `emitDecoratorMetadata`) a bare class-typed param would then resolve to nothing.
  constructor(
    @Inject(ProjectsRepository) private readonly repo: ProjectsRepository,
    @Inject(TRACKING_FRESHNESS_SECONDS) private readonly trackingFreshnessSeconds: number,
  ) {}

  /**
   * Which team's projects to read. Mirrors ReportsService.resolveScope, deliberately: ADMIN is
   * org-wide and may name any team, a MANAGER may name only their own, and an EMPLOYEE is
   * pinned to their own whatever the query says — the scope is fixed by identity and no
   * parameter widens it (CLAUDE.md §4). GET /projects has no @Roles (the macOS client calls
   * it as an EMPLOYEE), so this role check is the gate.
   */
  // `async` on purpose: resolveTeam throws, and a synchronous throw from a Promise-returning
  // method surprises every caller that only awaits. Rejecting keeps it uniform with the rest.
  async list(user: SessionUser, includeArchived = false, teamId?: string): Promise<Project[]> {
    return this.repo.listByTeam(this.resolveTeam(teamId, user), includeArchived);
  }

  private resolveTeam(teamId: string | undefined, user: SessionUser): string {
    if (!teamId || user.role === 'EMPLOYEE') return user.teamId;
    if (user.role === 'ADMIN' || teamId === user.teamId) return teamId;
    throw this.forbidden();
  }

  /**
   * A project belongs to a team, and ADMIN is an org-wide role while a MANAGER manages their
   * own team. Every project-administration path routes through here so that rule is decided
   * once — it used to be seven copies of the same comparison, which is how they would drift.
   */
  private assertCanAdminister(projectTeamId: string, actor: SessionUser): void {
    if (actor.role === 'ADMIN') return;
    if (projectTeamId !== actor.teamId) throw this.forbidden();
  }

  async createProject(dto: CreateProject, actor: SessionUser): Promise<Project> {
    this.assertCanAdminister(dto.teamId, actor);
    return this.repo.createProject(dto.teamId, dto.name, actor.id, dto.color);
  }

  async createTask(dto: CreateTask, actor: SessionUser): Promise<Task> {
    const project = await this.repo.findForActor(dto.projectId);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);
    return this.repo.createTask(dto.projectId, dto.name, actor.id);
  }

  async listTasks(id: string, actor: SessionUser): Promise<Task[]> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);
    return this.repo.listTasksForProject(id);
  }

  async setTaskArchived(taskId: string, dto: UpdateTask, actor: SessionUser): Promise<Task> {
    const task = await this.repo.findTaskForActor(taskId);
    if (!task) throw this.notFound();
    this.assertCanAdminister(task.teamId, actor);
    return this.repo.setTaskArchived(taskId, dto.archived, actor.id);
  }

  async update(id: string, dto: UpdateProject, actor: SessionUser): Promise<Project> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);

    // Form submits one field per action; an empty body is a harmless no-op.
    let result: Project = project;
    if (dto.archived !== undefined)
      result = await this.repo.setArchived(id, dto.archived, actor.id);
    if (dto.color !== undefined) result = await this.repo.setColor(id, dto.color, actor.id);
    if (dto.teamId !== undefined && dto.teamId !== project.teamId) {
      // Moving across an org boundary, so ADMIN only — a MANAGER must not be able to pull
      // another team's project into their own, nor push one out of reach.
      if (actor.role !== 'ADMIN') throw this.forbidden();
      result = await this.repo.setTeam(id, dto.teamId, actor.id);
    }
    return result;
  }

  async detail(id: string, query: ProjectDetailQuery, actor: SessionUser): Promise<ProjectDetail> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);

    const from = new Date(query.from);
    const to = new Date(query.to);
    const [trend, members, tasks] = await Promise.all([
      this.repo.hoursByDay(id, from, to, this.trackingFreshnessSeconds),
      this.repo.membersForProject(id, from, to, this.trackingFreshnessSeconds),
      this.repo.tasksForProject(id, from, to, this.trackingFreshnessSeconds),
    ]);
    const totalSeconds = members.reduce((sum, m) => sum + m.trackedSeconds, 0);

    // Re-validate on the way out (mirrors ReportsService); parse also strips any surprises.
    return ProjectDetailSchema.parse({
      from: query.from,
      to: query.to,
      projectId: id,
      name: project.name,
      color: project.color,
      archived: project.archived,
      totalSeconds,
      trend,
      members,
      tasks,
    });
  }

  async topApps(id: string, dto: ProjectDetailQuery, actor: SessionUser): Promise<ProjectTopApps> {
    const project = await this.repo.findForActor(id);
    if (!project) throw this.notFound();
    this.assertCanAdminister(project.teamId, actor);

    const { apps, totalSeconds } = await this.repo.topAppsForProject(
      id,
      new Date(dto.from),
      new Date(dto.to),
      this.trackingFreshnessSeconds,
    );
    const coveredSeconds = apps.reduce((sum, a) => sum + a.trackedSeconds, 0);
    const coveragePct =
      totalSeconds > 0
        ? Math.min(100, Math.max(0, Math.round((coveredSeconds / totalSeconds) * 100)))
        : 0;

    return {
      from: dto.from,
      to: dto.to,
      projectId: id,
      apps,
      coveredSeconds,
      totalSeconds,
      coveragePct,
    };
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
