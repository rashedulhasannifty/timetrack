import { z } from 'zod';
import { TeamSettingsSchema } from './team-settings.js';

export const TeamSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  settings: TeamSettingsSchema,
});

export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(200),
  settings: TeamSettingsSchema.partial().optional(),
});

export type Team = z.infer<typeof TeamSchema>;
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
