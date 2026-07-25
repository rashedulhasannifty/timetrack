import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateProjectSchema,
  CreateTaskSchema,
  ListProjectsQuerySchema,
  ProjectDetailQuerySchema,
  UpdateProjectSchema,
  type CreateProject,
  type CreateTask,
  type ListProjectsQuery,
  type Project,
  type ProjectDetail,
  type ProjectDetailQuery,
  type Task,
  type UpdateProject,
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
    return this.service.list(user, query.includeArchived);
  }

  @Post()
  @Roles('MANAGER', 'ADMIN')
  createProject(
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.createProject(dto, actor);
  }

  @Post('tasks')
  @Roles('MANAGER', 'ADMIN')
  createTask(
    @Body(new ZodValidationPipe(CreateTaskSchema)) dto: CreateTask,
    @CurrentUser() actor: SessionUser,
  ): Promise<Task> {
    return this.service.createTask(dto, actor);
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

  @Patch(':id')
  @Roles('MANAGER', 'ADMIN')
  archive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProject,
    @CurrentUser() actor: SessionUser,
  ): Promise<Project> {
    return this.service.archive(id, dto, actor);
  }
}
