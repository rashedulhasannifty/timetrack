import { Injectable, NotFoundException } from '@nestjs/common';
import { TeamSchema, TeamSettingsSchema, type Team } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { TeamsRepository } from './teams.repository.js';

@Injectable()
export class TeamsService {
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * Returns the caller's own team. The Json `settings` column is parsed through Zod
   * on read (CLAUDE.md §4) — a Json column with no schema is an untyped hole. Defaults
   * are applied here, so a partially-populated row still yields a complete policy.
   */
  async getMine(user: SessionUser): Promise<Team> {
    const row = await this.repo.getById(user.teamId);
    if (!row) throw new NotFoundException({ title: 'Team not found', status: 404 });
    return TeamSchema.parse({
      id: row.id,
      name: row.name,
      settings: TeamSettingsSchema.parse(row.settings ?? {}),
    });
  }
}
