import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  CreateProjectSchema,
  CreateTaskSchema,
  type CreateProject,
  type CreateTask,
  type Project,
  type Task,
} from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<Project[]> {
    return this.service.list(user);
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
}
