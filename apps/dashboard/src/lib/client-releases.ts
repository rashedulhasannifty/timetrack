import { z } from 'zod';
import type { Platform } from '@timetrack/contracts';
import { parseVersion, type LatestRelease, type LatestReleases } from './client-version';

/**
 * The public repositories the desktop apps themselves update from — one per platform, because
 * GitHub has a single releases/latest per repo (see the Windows app's AppConfig.UpdateRepo).
 * Reading the same feed keeps the dashboard's "update available" in step with the app's.
 */
const RELEASE_REPOS: Record<Platform, string> = {
  MACOS: 'rashedulhasansojib/timetrack-app',
  WINDOWS: 'rashedulhasansojib/niftytimer-windows',
};

const GitHubReleaseSchema = z.object({ tag_name: z.string(), published_at: z.iso.datetime() });

/** A GitHub release body → the release, or null when its tag is not a version. */
export function releaseFromGitHub(body: unknown): LatestRelease | null {
  const parsed = GitHubReleaseSchema.safeParse(body);
  if (!parsed.success) return null;
  const parts = parseVersion(parsed.data.tag_name);
  return parts ? { version: parts.join('.'), publishedAt: parsed.data.published_at } : null;
}

async function latestFor(repo: string): Promise<LatestRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'NiftyTimer-Dashboard' },
      // Cached across requests: unauthenticated GitHub allows 60 calls an hour per IP.
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? releaseFromGitHub(await res.json()) : null;
  } catch {
    // Offline, rate limited, or slow: the Users page shows versions without a verdict.
    return null;
  }
}

export async function fetchLatestReleases(): Promise<LatestReleases> {
  const [MACOS, WINDOWS] = await Promise.all([
    latestFor(RELEASE_REPOS.MACOS),
    latestFor(RELEASE_REPOS.WINDOWS),
  ]);
  return { MACOS, WINDOWS };
}
