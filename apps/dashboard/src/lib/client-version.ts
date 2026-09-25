import type { ClientInstall, Platform } from '@timetrack/contracts';

/** The newest published release for one platform. */
export interface LatestRelease {
  version: string;
  publishedAt: string;
}

export type LatestReleases = Record<Platform, LatestRelease | null>;

/**
 * Where an install stands against the latest release. Mirrors the apps' own UpdateEvaluator so
 * the admin sees what the person sees: `available` for a fresh release, `overdue` once it has
 * been out longer than the grace period, `unknown` when there is nothing to compare against.
 */
export type UpdateVerdict = 'current' | 'available' | 'overdue' | 'unknown';

/** The apps' grace period before an unapplied update escalates (UpdateEvaluator.graceDays). */
export const GRACE_DAYS = 7;

/**
 * "v0.6.1-pilot" → [0, 6, 1]. Leading "v" and any suffix are dropped, the same way the apps'
 * AppVersion reads a tag. Returns null for anything that does not start with a number.
 */
export function parseVersion(raw: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(raw.trim());
  return m ? m[1]!.split('.').map(Number) : null;
}

/** Numeric, part by part, with missing parts as 0: 0.9 < 0.10, and 0.2 == 0.2.0. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function updateVerdict(
  installed: string,
  latest: LatestRelease | null,
  now: Date,
): UpdateVerdict {
  const have = parseVersion(installed);
  const want = latest ? parseVersion(latest.version) : null;
  if (!have || !want || !latest) return 'unknown';
  if (compareVersions(have, want) >= 0) return 'current';
  const elapsed = now.getTime() - new Date(latest.publishedAt).getTime();
  return elapsed > GRACE_DAYS * 24 * 60 * 60 * 1000 ? 'overdue' : 'available';
}

export interface InstallView extends ClientInstall {
  verdict: UpdateVerdict;
  latest: string | null;
}

/** Group installs by user and attach each one's verdict. macOS sorts before Windows. */
export function installsByUser(
  installs: readonly ClientInstall[],
  latest: LatestReleases,
  now: Date,
): Map<string, InstallView[]> {
  const out = new Map<string, InstallView[]>();
  for (const i of [...installs].sort((a, b) => a.platform.localeCompare(b.platform))) {
    const release = latest[i.platform];
    const view: InstallView = {
      ...i,
      verdict: updateVerdict(i.version, release, now),
      latest: release?.version ?? null,
    };
    out.set(i.userId, [...(out.get(i.userId) ?? []), view]);
  }
  return out;
}
