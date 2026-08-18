import { z } from 'zod';
import { TeamSettingsFieldsSchema, TeamSettingsSchema } from './team-settings.js';

export const TeamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  settings: TeamSettingsSchema,
});

/**
 * POST /v1/teams — ADMIN creates a team. A team is the unit of management: a MANAGER manages
 * their own team, so creating a team is how a new manager's group comes into existence.
 *
 * `settings` is built from the DEFAULT-FREE field shape, not `TeamSettingsSchema.partial()`.
 * Zod 4's `.partial()` keeps each field's `.default()`, so a partial object would arrive with
 * every unspecified key already materialized — the service could no longer tell "the admin left
 * this alone" from "the admin chose that value". The service merges what is sent over the read
 * schema's defaults, the same way the admin settings PATCH already does.
 */
export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(200),
  settings: TeamSettingsFieldsSchema.partial().optional(),
});

/**
 * PATCH /v1/teams/:teamId — ADMIN renames a team.
 *
 * Deliberately NOT `CreateTeamSchema.partial()`. `CreateTeam` carries an optional `settings`,
 * so a partial of it would accept a monitoring-policy write on the rename route — policy edits
 * belong on the admin settings route, which audits them as `team.update_settings` with a
 * before/after diff. A rename is an identity change and audits as `team.rename`; keeping the
 * schemas separate keeps the two audit stories separate too.
 */
export const RenameTeamSchema = z.object({
  name: z.string().min(1).max(200),
});

/**
 * GET /v1/teams — ADMIN only. Backs both the team picker behind assigning a user and the
 * Teams admin surface, so each row carries how many people are in it: a team's member count is
 * what tells an admin whether it is safe to leave a policy alone, and it is one `_count` on a
 * query that already runs rather than a second round trip per row.
 */
export const TeamListItemSchema = TeamSchema.extend({
  memberCount: z.number().int().min(0),
  /**
   * Projects owned by this team. Moving someone between teams silently changes which projects
   * they can pick — this is what lets the admin UI say so before the move rather than after.
   */
  projectCount: z.number().int().min(0),
});

export const TeamListSchema = z.array(TeamListItemSchema);

export type Team = z.infer<typeof TeamSchema>;
export type TeamListItem = z.infer<typeof TeamListItemSchema>;
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
export type RenameTeam = z.infer<typeof RenameTeamSchema>;
export type TeamList = z.infer<typeof TeamListSchema>;
