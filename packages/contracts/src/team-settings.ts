import { z } from 'zod';

/**
 * Schema for the Team.settings Json column. Parsed on READ and on WRITE —
 * a Json column with no schema is an untyped hole in an otherwise typed system.
 */
export const TeamSettingsSchema = z.object({
  screenshotsEnabled: z.boolean().default(true),
  screenshotIntervalMinutes: z.number().int().min(5).max(60).default(10),
  screenshotBlur: z.enum(['NONE', 'BLUR', 'THUMBNAIL_ONLY']).default('NONE'),
  // PRD §10 — hard floor stops anyone setting screenshots to "forever" by accident.
  screenshotRetentionDays: z.number().int().min(1).max(180).default(30),
  activityRetentionDays: z.number().int().min(7).max(365).default(90),
  idleThresholdMinutes: z.number().int().min(1).max(60).default(5),
  captureWindowTitles: z.boolean().default(true),
  autoStartOnLogin: z.boolean().default(false),
  distractionAlertsEnabled: z.boolean().default(false),
  unproductiveApps: z.array(z.string()).default([]),
  productiveApps: z.array(z.string()).default([]),
});

export type TeamSettings = z.infer<typeof TeamSettingsSchema>;
