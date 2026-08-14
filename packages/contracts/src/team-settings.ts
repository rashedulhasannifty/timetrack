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
  // PRD §6.7 — the worker emails an EMPLOYEE when their tracked hours for the just-closed ISO
  // week fall BELOW this. 0 disables the reminder (nothing is < 0) and is the default: employee-
  // facing email is a deliberate, opt-in admin decision, like the unproductive lists below.
  // Server-side only. It rides EffectivePolicy to the macOS client because that schema embeds
  // TeamSettings wholesale (policy.ts) — the client has no use for it and must not act on it.
  timesheetReminderHours: z.number().int().min(0).max(80),
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
  // OFF by default — see the field comment. A deploy must not start emailing employees.
  timesheetReminderHours: teamSettingsFields.timesheetReminderHours.default(0),
  // Unproductive lists ship EMPTY — the product stays neutral until an admin classifies
  // (distraction lists are a deliberate, opt-in admin decision, not a shipped judgment).
  unproductiveApps: teamSettingsFields.unproductiveApps.default([]),
  // Dev/knowledge-work productive defaults. An app rule matches the frontmost app's display name
  // OR its bundleId. Stable-named apps are seeded by name; fragile-named apps (versioned or
  // unstable display names, e.g. Zoom reports as 'zoom.us') are seeded by their stable bundleId,
  // which survives renames. tmux/cmux run inside a terminal, so the terminal entry covers them.
  // High-confidence entries only; admins add the rest from the settings picker.
  productiveApps: teamSettingsFields.productiveApps.default([
    'Code',
    'Visual Studio Code',
    'Cursor',
    'Antigravity',
    'Zed',
    'Xcode',
    'IntelliJ IDEA',
    'PyCharm',
    'WebStorm',
    'Android Studio',
    'Sublime Text',
    'Terminal',
    'iTerm2',
    'Warp',
    'Ghostty',
    'Docker Desktop',
    'Postman',
    'TablePlus',
    'GitHub Desktop',
    'Figma',
    'Sketch',
    'Notion',
    'Obsidian',
    'Linear',
    'Microsoft Word',
    'Microsoft Excel',
    'Microsoft PowerPoint',
    'Microsoft Outlook',
    'Microsoft Teams',
    'Slack',
    // Fragile display name ('zoom.us') — seed the stable bundleId instead.
    'us.zoom.xos',
  ]),
  unproductiveSites: teamSettingsFields.unproductiveSites.default([]),
  // Registrable domains — dotted-suffix match means subdomains inherit (`niftyhq.ai` covers
  // `api.niftyhq.ai`/`docs.niftyhq.ai`). No blanket `api.*`/`docs.*` wildcards here: as defaults
  // they'd mark every `api.`/`docs.` host on the internet productive. The wildcard feature stays
  // available for admins who want it.
  productiveSites: teamSettingsFields.productiveSites.default([
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'stackoverflow.com',
    'developer.mozilla.org',
    'readthedocs.io',
    'npmjs.com',
    'pypi.org',
    'pkg.go.dev',
    'crates.io',
    'aws.amazon.com',
    'cloud.google.com',
    'portal.azure.com',
    'vercel.com',
    'netlify.com',
    'cloudflare.com',
    'atlassian.net',
    'linear.app',
    'asana.com',
    'trello.com',
    'notion.so',
    'clickup.com',
    'figma.com',
    'docs.google.com',
    'drive.google.com',
    'meet.google.com',
    'circleci.com',
    'datadoghq.com',
    'sentry.io',
    'niftyhq.ai',
  ]),
});

export type TeamSettings = z.infer<typeof TeamSettingsSchema>;
