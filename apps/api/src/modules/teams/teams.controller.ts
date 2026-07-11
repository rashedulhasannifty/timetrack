import { Controller, Get } from '@nestjs/common';
import type { Team } from '@timetrack/contracts';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator.js';
import { TeamsService } from './teams.service.js';

@Controller('teams')
export class TeamsController {
  constructor(private readonly service: TeamsService) {}

  @Get('current')
  current(@CurrentUser() user: SessionUser): Promise<Team> {
    return this.service.getMine(user);
  }
}
