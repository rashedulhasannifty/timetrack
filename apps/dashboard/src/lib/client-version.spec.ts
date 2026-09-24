import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  installsByUser,
  parseVersion,
  updateVerdict,
  type LatestReleases,
} from './client-version';
import { releaseFromGitHub } from './client-releases';

const NOW = new Date('2026-09-24T12:00:00Z');
const release = (version: string, daysAgo: number) => ({
  version,
  publishedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});

describe('parseVersion / compareVersions', () => {
  it('reads release tags the way the apps do', () => {
    expect(parseVersion('v0.6.1-pilot')).toEqual([0, 6, 1]);
    expect(parseVersion('v0.2.1-windows-pilot')).toEqual([0, 2, 1]);
    expect(parseVersion('nightly')).toBeNull();
  });

  it('compares numerically, padding missing parts', () => {
    expect(compareVersions([0, 9], [0, 10])).toBeLessThan(0);
    expect(compareVersions([0, 2], [0, 2, 0])).toBe(0);
    expect(compareVersions([1, 0, 0], [0, 99])).toBeGreaterThan(0);
  });
});

describe('updateVerdict', () => {
  it('is current when the install is at or past the latest release', () => {
    expect(updateVerdict('0.6.1', release('0.6.1', 30), NOW)).toBe('current');
    expect(updateVerdict('0.7.0', release('0.6.1', 30), NOW)).toBe('current');
  });

  it('is available for a fresh release and overdue after the 7-day grace', () => {
    expect(updateVerdict('0.6.0', release('0.6.1', 2), NOW)).toBe('available');
    expect(updateVerdict('0.6.0', release('0.6.1', 8), NOW)).toBe('overdue');
  });

  it('is unknown when GitHub gave us nothing or the version is unreadable', () => {
    expect(updateVerdict('0.6.0', null, NOW)).toBe('unknown');
    expect(updateVerdict('garbage', release('0.6.1', 8), NOW)).toBe('unknown');
  });
});

describe('installsByUser', () => {
  it('judges each platform against its own release, macOS first', () => {
    const latest: LatestReleases = { MACOS: release('0.6.1', 30), WINDOWS: null };
    const map = installsByUser(
      [
        { userId: 'u1', platform: 'WINDOWS', version: '0.2.0', lastSeenAt: NOW.toISOString() },
        { userId: 'u1', platform: 'MACOS', version: '0.5.1', lastSeenAt: NOW.toISOString() },
        { userId: 'u2', platform: 'MACOS', version: '0.6.1', lastSeenAt: NOW.toISOString() },
      ],
      latest,
      NOW,
    );
    expect(map.get('u1')?.map((i) => [i.platform, i.verdict, i.latest])).toEqual([
      ['MACOS', 'overdue', '0.6.1'],
      ['WINDOWS', 'unknown', null],
    ]);
    expect(map.get('u2')?.[0]?.verdict).toBe('current');
    expect(map.has('u3')).toBe(false);
  });
});

describe('releaseFromGitHub', () => {
  it('turns a release body into a clean version', () => {
    expect(
      releaseFromGitHub({ tag_name: 'v0.6.1-pilot', published_at: '2026-08-28T12:21:46Z' }),
    ).toEqual({ version: '0.6.1', publishedAt: '2026-08-28T12:21:46Z' });
  });

  it('rejects a body that is not a release, or a tag that is not a version', () => {
    expect(releaseFromGitHub({ message: 'API rate limit exceeded' })).toBeNull();
    expect(
      releaseFromGitHub({ tag_name: 'latest', published_at: '2026-08-28T12:21:46Z' }),
    ).toBeNull();
  });
});
