import { describe, it, expect } from 'vitest';
import type { Screenshot } from '@timetrack/contracts';
import {
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
  it('renders the UTC wall-clock time of the capture', () => {
    expect(shotTime('2026-08-14T12:43:47.000Z')).toBe('12:43');
  });
});
