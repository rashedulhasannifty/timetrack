import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateTeamSchema, type CreateTeam, type Team } from '@timetrack/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { TeamsService } from './teams.service.js';

@Controller('teams')
export class TeamsController {
  constructor(private readonly service: TeamsService) {}

  @Get('current')
  current(@CurrentUser() user: SessionUser): Promise<Team> {
    return this.service.getMine(user);
  }

  /**
   * ADMIN-only, org-wide. The team list IS the roster of management boundaries, so a MANAGER
   * must not read it — that would hand them every other team's name and monitoring policy.
   * Declared after `current` so the literal segment is matched first.
   */
  @Get()
  @Roles('ADMIN')
  list(): Promise<Team[]> {
    return this.service.list();
  }

  @Post()
  @Roles('ADMIN')
  create(
    @Body(new ZodValidationPipe(CreateTeamSchema)) dto: CreateTeam,
    @CurrentUser() actor: SessionUser,
  ): Promise<Team> {
    return this.service.create(dto, actor);
  }
}
