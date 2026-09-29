import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  BulkCreateProjectsSchema,
  CreateProjectSchema,
  CreateSubprojectSchema,
  CreateTaskSchema,
  ListProjectsQuerySchema,
  ProjectDetailQuerySchema,
  UpdateProjectSchema,
  UpdateSubprojectSchema,
  UpdateTaskSchema,
  type BulkCreateProjects,
  type BulkCreateProjectsResult,
  type CreateProject,
  type CreateSubproject,
  type CreateTask,
  type ListProjectsQuery,
  type Project,
  type ProjectDetail,
  type ProjectDetailQuery,
  type ProjectTopApps,
  type Subproject,
  type Task,
  type UpdateProject,
  type UpdateSubproject,
  type UpdateTask,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ProjectsService } from './projects.service.js';

// No @ResourceScope: projects are team-scoped, not user-scoped, so the global
// ResourceGuard (which resolves a userId) does not apply. Own-team authorization is
// enforced in ProjectsService.
@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(ListProjectsQuerySchema)) query: ListProjectsQuery,
  ): Promise<Project[]> {
    return this.service.list(user, query.includeArchived, query.teamId);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  createProject(
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.createProject(dto, actor);
  }

  /** ADMIN only: an import spans the org (its duplicate check reads every team's clients). */
  @Post('bulk')
  @Roles('ADMIN')
  bulkCreate(
    @Body(new ZodValidationPipe(BulkCreateProjectsSchema)) dto: BulkCreateProjects,
    @CurrentUser() actor: SessionUser,
  ): Promise<BulkCreateProjectsResult> {
    return this.service.bulkCreate(dto, actor);
  }

  @Post('tasks')
  @Roles('MANAGER', 'ADMIN')
  createTask(
    @Body(new ZodValidationPipe(CreateTaskSchema)) dto: CreateTask,
    @CurrentUser() actor: SessionUser,
  ): Promise<Task> {
    return this.service.createTask(dto, actor);
  }

  @Get(':id/tasks')
  @Roles('MANAGER', 'ADMIN')
  listTasks(@Param('id') id: string, @CurrentUser() user: SessionUser): Promise<Task[]> {
    return this.service.listTasks(id, user);
  }

  @Patch('tasks/:id')
  @Roles('MANAGER', 'ADMIN')
  updateTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) dto: UpdateTask,
    @CurrentUser() actor: SessionUser,
  ): Promise<Task> {
    return this.service.updateTask(id, dto, actor);
  }

  @Get(':id/detail')
  @Roles('MANAGER', 'ADMIN')
  detail(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ProjectDetailQuerySchema)) query: ProjectDetailQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ProjectDetail> {
    return this.service.detail(id, query, user);
  }

  @Get(':id/top-apps')
  @Roles('MANAGER', 'ADMIN')
  topApps(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ProjectDetailQuerySchema)) query: ProjectDetailQuery,
    @CurrentUser() user: SessionUser,
  ): Promise<ProjectTopApps> {
    return this.service.topApps(id, query, user);
  }

  @Post('subprojects')
  @Roles('MANAGER', 'ADMIN')
  createSubproject(
    @Body(new ZodValidationPipe(CreateSubprojectSchema)) dto: CreateSubproject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Subproject> {
    return this.service.createSubproject(dto, actor);
  }

  @Patch('subprojects/:id')
  @Roles('MANAGER', 'ADMIN')
  updateSubproject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSubprojectSchema)) dto: UpdateSubproject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Subproject> {
    return this.service.updateSubproject(id, dto, actor);
  }

  @Get(':id/subprojects')
  @Roles('MANAGER', 'ADMIN')
  listSubprojects(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<Subproject[]> {
    return this.service.listSubprojects(id, user);
  }

  @Patch(':id')
  @Roles('MANAGER', 'ADMIN')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.update(id, dto, actor);
  }
}
