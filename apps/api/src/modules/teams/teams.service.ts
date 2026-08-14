import { Injectable, NotFoundException } from '@nestjs/common';
import { TeamSchema, TeamSettingsSchema, type CreateTeam, type Team } from '@timetrack/contracts';
import type { SessionUser } from '../../common/decorators/current-user.decorator.js';
import { TeamsRepository, type TeamRow } from './teams.repository.js';

@Injectable()
export class TeamsService {
  constructor(private readonly repo: TeamsRepository) {}

  /**
   * The Json `settings` column is parsed through Zod on read (CLAUDE.md §4) — a Json column
   * with no schema is an untyped hole. Defaults are applied here, so a partially-populated or
   * legacy row still yields a complete policy.
   */
  private toTeam(row: TeamRow): Team {
    return TeamSchema.parse({
      id: row.id,
      name: row.name,
      settings: TeamSettingsSchema.parse(row.settings ?? {}),
    });
  }

  /** Returns the caller's own team. */
  async getMine(user: SessionUser): Promise<Team> {
    const row = await this.repo.getById(user.teamId);
    if (!row) throw new NotFoundException({ title: 'Team not found', status: 404 });
    return this.toTeam(row);
  }

  /** ADMIN-only. Backs the team picker used to assign a user to a manager. */
  async list(): Promise<Team[]> {
    const rows = await this.repo.list();
    return rows.map((row) => this.toTeam(row));
  }

  /**
   * ADMIN-only. The submitted settings are a DEFAULT-FREE partial, so merging them over
   * `TeamSettingsSchema.parse({})` yields a complete, validated policy — an admin who sends
   * only `{ screenshotsEnabled: false }` gets every other field at its default rather than a
   * half-populated Json blob. Never persists an unvalidated patch.
   */
  async create(dto: CreateTeam, actor: SessionUser): Promise<Team> {
    const settings = TeamSettingsSchema.parse({ ...(dto.settings ?? {}) });
    const row = await this.repo.create(dto.name, settings, actor.id);
    return this.toTeam(row);
  }
}
