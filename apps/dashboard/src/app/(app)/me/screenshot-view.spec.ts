import { describe, it, expect } from 'vitest';
import type { Screenshot } from '@timetrack/contracts';
import {
  groupLabel,
  groupShots,
  shotDescription,
  tileCaption,
  isOpenable,
  openableShots,
  shotTime,
  stepIndex,
  tileMode,
  toScreenshotView,
  type ScreenshotView,
} from './screenshot-view';

const base: Screenshot = {
  id: '019f6ffe-910f-70e7-a56d-3ee574d99d7e',
  userId: '019f6fe4-06bb-755d-b9b8-ebbfc1a77159',
  timestamp: '2026-07-17T12:13:02.000Z',
  storageKey: 'raw/u/i',
  thumbnailKey: null,
  blurred: false,
  status: 'PENDING',
  redactedReason: null,
  captureGroupId: null,
  displayIndex: null,
  displayCount: null,
};

describe('tileMode', () => {
  it('READY with a presigned url → redactable', () => {
    expect(tileMode({ ...base, status: 'READY', url: 'http://minio/x' })).toBe('redactable');
  });
  it('REDACTED → redacted', () => {
    expect(tileMode({ ...base, status: 'REDACTED', redactedReason: 'reason' })).toBe('redacted');
  });
  it('PENDING → pending', () => {
    expect(tileMode({ ...base, status: 'PENDING' })).toBe('pending');
  });
  it('READY without a url → pending (nothing to redact yet)', () => {
    expect(tileMode({ ...base, status: 'READY' })).toBe('pending');
  });
});

describe('toScreenshotView', () => {
  it('keeps fullUrl (the lightbox needs it) and strips the internal object paths', () => {
    const fullShot: Screenshot = {
      ...base,
      status: 'READY',
      url: 'http://minio/x',
      fullUrl: 'http://minio/x-full',
    };
    const view = toScreenshotView(fullShot);
    expect(Object.keys(view).sort()).toEqual([
      'captureGroupId',
      'displayCount',
      'displayIndex',
      'fullUrl',
      'id',
      'redactedReason',
      'status',
      'timestamp',
      'url',
    ]);
    // Object paths stay server-side — a presigned URL is scoped to one object and expires; a
    // storage key is neither.
    expect(view).not.toHaveProperty('storageKey');
    expect(view).not.toHaveProperty('thumbnailKey');
    expect(view).not.toHaveProperty('blurred');
    expect(view).not.toHaveProperty('userId');
  });
});

const ready = (id: string, timestamp: string): ScreenshotView => ({
  id,
  status: 'READY',
  url: 'http://minio/thumb',
  fullUrl: 'http://minio/full',
  redactedReason: null,
  timestamp,
  captureGroupId: null,
  displayIndex: null,
  displayCount: null,
});

describe('isOpenable / openableShots', () => {
  it('opens a READY shot that has a full-res object', () => {
    expect(isOpenable(ready('a', base.timestamp))).toBe(true);
  });

  it('refuses a READY shot with no fullUrl — there is nothing to enlarge', () => {
    expect(isOpenable({ ...ready('a', base.timestamp), fullUrl: undefined })).toBe(false);
  });

  it('refuses redacted and pending tiles', () => {
    expect(isOpenable({ ...ready('a', base.timestamp), status: 'REDACTED' })).toBe(false);
    expect(isOpenable({ ...ready('a', base.timestamp), status: 'PENDING' })).toBe(false);
  });

  it('keeps display order while dropping the ones that cannot open', () => {
    const shots: ScreenshotView[] = [
      ready('a', '2026-07-17T12:00:00.000Z'),
      { ...ready('b', '2026-07-17T12:10:00.000Z'), status: 'REDACTED' },
      ready('c', '2026-07-17T12:20:00.000Z'),
    ];
    expect(openableShots(shots).map((s) => s.id)).toEqual(['a', 'c']);
  });
});

const inGroup = (
  id: string,
  timestamp: string,
  captureGroupId: string,
  displayIndex: number,
  displayCount: number,
): ScreenshotView => ({
  ...ready(id, timestamp),
  captureGroupId,
  displayIndex,
  displayCount,
});

describe('groupShots', () => {
  it('gathers the displays of one capture tick into a single group', () => {
    const groups = groupShots([
      inGroup('a', '2026-07-17T12:00:00.000Z', 'g1', 0, 2),
      inGroup('b', '2026-07-17T12:00:00.000Z', 'g1', 1, 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.shots.map((s) => s.id)).toEqual(['a', 'b']);
    expect(groups[0]!.attempted).toBe(2);
    expect(groups[0]!.key).toBe('g1');
  });

  it('keeps separate ticks apart and preserves newest-first order', () => {
    const groups = groupShots([
      inGroup('c', '2026-07-17T12:10:00.000Z', 'g2', 0, 1),
      inGroup('a', '2026-07-17T12:00:00.000Z', 'g1', 0, 2),
      inGroup('b', '2026-07-17T12:00:00.000Z', 'g1', 1, 2),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['g2', 'g1']);
  });

  /**
   * Captures taken before multi-display support carry no group id. They were single main-display
   * grabs, so each is genuinely its own group — and two of them must never collapse together
   * just because both have a null id.
   */
  it('gives every ungrouped legacy shot its own group', () => {
    const groups = groupShots([
      ready('a', '2026-07-17T12:00:00.000Z'),
      ready('b', '2026-07-17T12:10:00.000Z'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['a', 'b']);
    expect(groups.every((g) => g.shots.length === 1)).toBe(true);
  });

  it('is empty for a day with no captures', () => {
    expect(groupShots([])).toEqual([]);
  });
});

describe('groupLabel', () => {
  it('says nothing for an ordinary single-display capture', () => {
    expect(groupLabel(groupShots([ready('a', base.timestamp)])[0]!)).toBeNull();
  });

  it('counts the displays of a complete group', () => {
    const group = groupShots([
      inGroup('a', base.timestamp, 'g1', 0, 2),
      inGroup('b', base.timestamp, 'g1', 1, 2),
    ])[0]!;
    expect(groupLabel(group)).toBe('2 displays');
  });

  /**
   * A flaky external monitor drops out mid-tick: the group must show as incomplete rather than
   * looking like the whole desk was captured.
   */
  it('flags a group where a display failed to capture', () => {
    const group = groupShots([inGroup('a', base.timestamp, 'g1', 0, 2)])[0]!;
    expect(groupLabel(group)).toBe('1 of 2 displays');
  });
});

describe('tileCaption', () => {
  it('names the display inside a multi-display group — the time is on the group header', () => {
    const group = groupShots([
      inGroup('a', '2026-08-14T12:43:47.000Z', 'g1', 0, 2),
      inGroup('b', '2026-08-14T12:43:47.000Z', 'g1', 1, 2),
    ])[0]!;
    expect(tileCaption(group.shots[0]!, group)).toBe('Display 1');
    expect(tileCaption(group.shots[1]!, group)).toBe('Display 2');
  });

  it('falls back to the capture time for a lone shot', () => {
    const group = groupShots([ready('a', '2026-08-14T12:43:47.000Z')])[0]!;
    expect(tileCaption(group.shots[0]!, group)).toBe('18:43');
  });
});

describe('shotDescription', () => {
  it('names the display so two shots from one tick do not read as the same capture twice', () => {
    expect(shotDescription(inGroup('a', '2026-08-14T12:43:47.000Z', 'g1', 1, 2))).toBe(
      '18:43 · Display 2',
    );
  });

  it('is just the time when the client recorded no display', () => {
    expect(shotDescription(ready('a', '2026-08-14T12:43:47.000Z'))).toBe('18:43');
  });
});

describe('stepIndex', () => {
  it('moves within bounds', () => {
    expect(stepIndex(3, 0, 1)).toBe(1);
    expect(stepIndex(3, 2, -1)).toBe(1);
  });

  it('does NOT wrap at either end', () => {
    // Wrapping from the last capture of the day back to the first reads as a bug on a
    // timestamped sequence, so paging stops instead.
    expect(stepIndex(3, 2, 1)).toBeNull();
    expect(stepIndex(3, 0, -1)).toBeNull();
  });

  it('returns null when there is nothing to page through', () => {
    expect(stepIndex(0, 0, 1)).toBeNull();
  });
});

describe('shotTime', () => {
  it('renders the Dhaka wall-clock time of the capture', () => {
    // 12:43:47Z === 18:43 Dhaka (UTC+6).
    expect(shotTime('2026-08-14T12:43:47.000Z')).toBe('18:43');
  });
});
