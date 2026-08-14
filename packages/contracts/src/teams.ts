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

/** GET /v1/teams — ADMIN only. The picker behind assigning a user to a team. */
export const TeamListSchema = z.array(TeamSchema);

export type Team = z.infer<typeof TeamSchema>;
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
export type TeamList = z.infer<typeof TeamListSchema>;
