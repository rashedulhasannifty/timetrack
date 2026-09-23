import type { Platform, TeamOverviewRow } from '@timetrack/contracts';

const LABEL: Record<Platform, string> = { MACOS: 'Mac', WINDOWS: 'Windows' };

/**
 * The per-platform line under "N tracking now", or null when there is nothing honest to say.
 *
 * The counts ALWAYS sum to the number tracking. A client too old to report a platform leaves
 * null, and those are counted as "unknown" rather than dropped: rendering "1 Mac · 1 Windows"
 * while three people are tracking reads as two, which is worse than saying nothing. This is
 * also why the card cannot be split into a Mac card and a Windows card — there is a third
 * state, and it does not go away until every client in the fleet has updated.
 *
 * Returns null when nobody is tracking, and when NO ONE reports a platform — during the
 * rollout "3 unknown" is noise, so the card just shows its count and names, exactly as before.
 */
export function platformBreakdown(rows: TeamOverviewRow[]): string | null {
  const live = rows.filter((r) => r.tracking);
  if (live.length === 0) return null;

  const counts = new Map<Platform, number>();
  let unknown = 0;
  for (const r of live) {
    if (r.platform === null) unknown += 1;
    else counts.set(r.platform, (counts.get(r.platform) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  // Fixed order, so the line does not reshuffle between refreshes as people start and stop.
  const parts = (['MACOS', 'WINDOWS'] as const)
    .filter((p) => counts.has(p))
    .map((p) => `${counts.get(p)} on ${LABEL[p]}`);
  if (unknown > 0) parts.push(`${unknown} unknown`);

  return parts.join(' · ');
}
