import { z } from 'zod';
import { TeamSettingsFieldsSchema } from './team-settings.js';

/**
 * The audit actor for rows written by a background job (no human actor), e.g. the nightly
 * retention cleanup. Must be a valid UUID because AuditLogEntrySchema.actorId is z.uuid()
 * (the Slice 4.2 audit UI parses it); the nil UUID is the recognizable sentinel.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** PATCH /admin/settings — a partial update. Uses the DEFAULT-FREE field schema so an absent
 * key is omitted, never reset to a default (a one-field edit must not silently reset others). */
export const UpdateSettingsSchema = TeamSettingsFieldsSchema.partial();

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
