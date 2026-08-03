import { z } from 'zod';

/**
 * Field constraints for Team.settings, WITHOUT defaults. The read schema (below) adds
 * per-field defaults; the PATCH schema (admin.ts) uses these bare fields so a partial update
 * never materializes a default for a key the client didn't send — otherwise a one-field edit
 * would silently reset every other field (e.g. re-enable screenshots). See Slice 1.2 review.
 */
const teamSettingsFields = {
  screenshotsEnabled: z.boolean(),
  screenshotIntervalMinutes: z.number().int().min(5).max(60),
  screenshotBlur: z.enum(['NONE', 'BLUR', 'THUMBNAIL_ONLY']),
  // PRD §10 — hard floor stops anyone setting screenshots to "forever" by accident.
  screenshotRetentionDays: z.number().int().min(1).max(180),
  activityRetentionDays: z.number().int().min(7).max(365),
  idleThresholdMinutes: z.number().int().min(1).max(60),
  captureWindowTitles: z.boolean(),
  autoStartOnLogin: z.boolean(),
  distractionAlertsEnabled: z.boolean(),
  // Minutes of continued distraction between re-nudges while a streak keeps going (client
  // DistractionMonitor). Lower = more frequent reminders.
  distractionRepeatMinutes: z.number().int().min(1).max(60),
  // App-name lists — matched against the frontmost app name (client Categorizer).
  unproductiveApps: z.array(z.string()),
  productiveApps: z.array(z.string()),
  // Site (host) lists — matched against the front browser's active-tab host, SEPARATE from
  // the app lists (slice 4.5). e.g. 'youtube.com'; dotted-suffix match on the client. A term
  // ending in '.*' (e.g. 'api.*') is a leading-label wildcard: it matches any host whose first
  // label is that prefix (api.stripe.com).
  unproductiveSites: z.array(z.string()),
  productiveSites: z.array(z.string()),
};

/** Bare (default-free) shape — the source for the partial PATCH schema. */
export const TeamSettingsFieldsSchema = z.object(teamSettingsFields);

/**
 * Schema for the Team.settings Json column. Parsed on READ and on WRITE — per-field defaults
 * fill a partial/legacy row into a complete policy. Do NOT validate a PATCH body with this
 * (its defaults would materialize absent keys); use UpdateSettingsSchema for that.
 */
export const TeamSettingsSchema = z.object({
  screenshotsEnabled: teamSettingsFields.screenshotsEnabled.default(true),
  screenshotIntervalMinutes: teamSettingsFields.screenshotIntervalMinutes.default(10),
  screenshotBlur: teamSettingsFields.screenshotBlur.default('NONE'),
  screenshotRetentionDays: teamSettingsFields.screenshotRetentionDays.default(30),
  activityRetentionDays: teamSettingsFields.activityRetentionDays.default(90),
  idleThresholdMinutes: teamSettingsFields.idleThresholdMinutes.default(5),
  captureWindowTitles: teamSettingsFields.captureWindowTitles.default(true),
  autoStartOnLogin: teamSettingsFields.autoStartOnLogin.default(false),
  distractionAlertsEnabled: teamSettingsFields.distractionAlertsEnabled.default(false),
  distractionRepeatMinutes: teamSettingsFields.distractionRepeatMinutes.default(5),
  unproductiveApps: teamSettingsFields.unproductiveApps.default([]),
  // Dev-focused productive defaults. App names must match the macOS frontmost app name exactly;
  // terminal tools like tmux/cmux run inside these terminals, so the terminal covers them.
  productiveApps: teamSettingsFields.productiveApps.default([
    'Code',
    'Visual Studio Code',
    'Cursor',
    'Antigravity',
    'Terminal',
    'iTerm2',
    'Warp',
    'Ghostty',
    'Microsoft Word',
    'Microsoft Excel',
    'Microsoft PowerPoint',
    'Microsoft Outlook',
    'Microsoft Teams',
    'Slack',
  ]),
  unproductiveSites: teamSettingsFields.unproductiveSites.default([]),
  productiveSites: teamSettingsFields.productiveSites.default([
    'github.com',
    'niftyhq.ai',
    'api.*',
    'docs.*',
  ]),
});

export type TeamSettings = z.infer<typeof TeamSettingsSchema>;
