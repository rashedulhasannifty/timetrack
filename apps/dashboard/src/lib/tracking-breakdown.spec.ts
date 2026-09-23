import { describe, it, expect } from 'vitest';
import type { Platform, TeamOverviewRow } from '@timetrack/contracts';
import { platformBreakdown } from './tracking-breakdown';

const row = (name: string, tracking: boolean, platform: Platform | null): TeamOverviewRow => ({
  userId: `019797a0-0000-7000-8000-0000000000${name.charCodeAt(0).toString(16)}`,
  name,
  tracking,
  platform,
  trackedSecondsToday: 60,
});

describe('platformBreakdown', () => {
  it('counts each platform that reported one', () => {
    expect(
      platformBreakdown([
        row('Ada', true, 'MACOS'),
        row('Bea', true, 'MACOS'),
        row('Cy', true, 'WINDOWS'),
      ]),
    ).toBe('2 on Mac · 1 on Windows');
  });

  /**
   * The load-bearing case, and the reason this is one card rather than a Mac card and a Windows
   * card: a client too old to report a platform is a third state. Dropping it would render
   * "1 on Mac · 1 on Windows" beside a headline of 3, which reads as 2.
   */
  it('counts unreported clients as unknown so the parts sum to the headline', () => {
    const line = platformBreakdown([
      row('Ada', true, 'MACOS'),
      row('Bea', true, 'WINDOWS'),
      row('Cy', true, null),
    ]);
    expect(line).toBe('1 on Mac · 1 on Windows · 1 unknown');

    const total = [...(line ?? '').matchAll(/(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(total).toBe(3);
  });

  /** Mid-rollout every client is silent; "3 unknown" is noise, so the line hides itself. */
  it('renders nothing when nobody reports a platform', () => {
    expect(platformBreakdown([row('Ada', true, null), row('Bea', true, null)])).toBeNull();
  });

  it('renders nothing when nobody is tracking', () => {
    expect(platformBreakdown([row('Ada', false, null)])).toBeNull();
    expect(platformBreakdown([])).toBeNull();
  });

  /** A platform on a row that is NOT tracking describes a finished span, not a live one. */
  it('ignores platforms on rows that are not tracking', () => {
    expect(platformBreakdown([row('Ada', true, 'MACOS'), row('Bea', false, 'WINDOWS')])).toBe(
      '1 on Mac',
    );
  });

  /** Fixed order, so the line does not reshuffle between refreshes. */
  it('always orders Mac before Windows regardless of row order', () => {
    expect(platformBreakdown([row('Ada', true, 'WINDOWS'), row('Bea', true, 'MACOS')])).toBe(
      '1 on Mac · 1 on Windows',
    );
  });
});
