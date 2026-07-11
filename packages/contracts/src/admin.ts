import { z } from 'zod';
import { TeamSettingsSchema } from './team-settings.js';

/** PATCH /admin/settings — a partial update to the team's monitoring policy. */
export const UpdateSettingsSchema = TeamSettingsSchema.partial();

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  actorId: z.uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  diff: z.unknown().nullable(),
  timestamp: z.iso.datetime(),
});

export const AuditLogQuerySchema = z.object({
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

/**
 * PRD §4.4 / §6.6 — right-to-erasure. The deletion itself writes an audit_log row
 * in the same transaction as the delete (CLAUDE.md §4).
 */
export const EraseUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export type EraseUser = z.infer<typeof EraseUserSchema>;
