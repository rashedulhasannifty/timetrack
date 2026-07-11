import { Injectable, NotImplementedException } from '@nestjs/common';
import type { CreateProject, CreateTask, Project, Task } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { ProjectsRepository } from './projects.repository.js';

@Injectable()
export class ProjectsService {
  constructor(private readonly repo: ProjectsRepository) {}

  list(user: SessionUser): Promise<Project[]> {
    return this.repo.listByTeam(user.teamId);
  }

  createProject(_dto: CreateProject, _actor: SessionUser): Promise<Project> {
    // TODO(scaffold): assert actor owns dto.teamId, then create.
    throw new NotImplementedException('projects.createProject not yet implemented');
  }

  createTask(_dto: CreateTask, _actor: SessionUser): Promise<Task> {
    // TODO(scaffold): assert the project is in the actor's team, then create.
    throw new NotImplementedException('projects.createTask not yet implemented');
  }
}
