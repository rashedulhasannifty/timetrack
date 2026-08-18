import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateTeamSchema,
  RenameTeamSchema,
  type CreateTeam,
  type RenameTeam,
  type Team,
  type TeamListItem,
} from '@timetrack/contracts';
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
  list(): Promise<TeamListItem[]> {
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

  /**
   * Rename a team. Deliberately no `@ResourceScope` (CLAUDE.md §8.6): teams are org-wide
   * objects with no owning user to scope against, so `@Roles('ADMIN')` IS the authorization —
   * the same gate `list` and `create` already rely on. A MANAGER gets a 403 here, which is the
   * point: the team list is the roster of management boundaries.
   */
  @Patch(':teamId')
  @Roles('ADMIN')
  rename(
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(RenameTeamSchema)) dto: RenameTeam,
    @CurrentUser() actor: SessionUser,
  ): Promise<Team> {
    return this.service.rename(teamId, dto, actor);
  }
}
