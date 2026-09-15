import type { TeamSettings } from '@timetrack/contracts';

/**
 * How long a team's screenshots are kept, as the admin reads it. The keep-forever flag wins over
 * the days, which stay stored (unused) for when the flag is turned off — so never show them as
 * if they applied.
 */
export function screenshotRetentionLabel(
  settings: Pick<TeamSettings, 'screenshotRetentionDays' | 'keepScreenshotsForever'>,
): string {
  return settings.keepScreenshotsForever
    ? 'Kept until turned off'
    : `${settings.screenshotRetentionDays} days`;
}
