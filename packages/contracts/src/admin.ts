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

export const AuditLogListItemSchema = AuditLogEntrySchema.extend({
  // Resolved by the API from actorId; null when the actor is not (or no longer) a User.
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
});

/** One page of the audit log. nextCursor is the id to pass back for the next page, or null. */
export const AuditLogPageSchema = z.object({
  items: z.array(AuditLogListItemSchema),
  nextCursor: z.uuid().nullable(),
});

export const AuditLogQuerySchema = z.object({
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  // Pagination — query strings, so coerce. Keyset cursor is the last-seen row id (a uuid).
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

/**
 * PRD §4.4 / §6.6 — right-to-erasure. The deletion itself writes an audit_log row
 * in the same transaction as the delete (CLAUDE.md §4).
 */
export const EraseUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * GET /admin/observed-apps — app names the team's fleet has actually reported (recent window),
 * ranked by usage. Powers the settings classification picker so admins classify from real data
 * instead of guessing the exact macOS app name. Hosts are intentionally NOT offered — they never
 * leave the device, so there is nothing to suggest for sites.
 */
export const ObservedAppsSchema = z.object({
  appNames: z.array(z.string()),
});

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type AuditLogListItem = z.infer<typeof AuditLogListItemSchema>;
export type AuditLogPage = z.infer<typeof AuditLogPageSchema>;
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
export type EraseUser = z.infer<typeof EraseUserSchema>;
export type ObservedApps = z.infer<typeof ObservedAppsSchema>;
