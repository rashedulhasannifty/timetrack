import { z } from 'zod';
import { TeamSettingsSchema } from './team-settings.js';

/**
 * GET /policy/effective — the client calls this before it may capture anything.
 * PRD §4.1: if `ackRequired` is true, the client MUST NOT start monitoring.
 */
export const EffectivePolicySchema = z.object({
  ackRequired: z.boolean(),
  policyVersion: z.string(),
  policyText: z.string(),
  settings: TeamSettingsSchema,
});

export type EffectivePolicy = z.infer<typeof EffectivePolicySchema>;
