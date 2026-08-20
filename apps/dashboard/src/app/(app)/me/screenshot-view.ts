import { clockOf, type Screenshot } from '@timetrack/contracts';

export type TileMode = 'redactable' | 'redacted' | 'pending';

/**
 * The subset of Screenshot fields the client panel actually renders. Internal object paths
 * (`storageKey`, `thumbnailKey`) stay out of the RSC payload shipped to the browser.
 *
 * `fullUrl` IS included: opening a capture at full size is the whole point of the grid, and the
 * browser cannot fetch the object without a presigned URL. It is the same class of value as
 * `url` (short-lived, scoped to one object) — but it is a bearer link for as long as it lives,
 * so it belongs in the page payload and nowhere more durable.
 */
export type ScreenshotView = Pick<
  Screenshot,
  'id' | 'status' | 'url' | 'fullUrl' | 'redactedReason' | 'timestamp'
>;

export function toScreenshotView(s: Screenshot): ScreenshotView {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
    fullUrl: s.fullUrl,
    redactedReason: s.redactedReason,
    timestamp: s.timestamp,
  };
}

/**
 * How a screenshot tile renders: a REDACTED tombstone, a redactable READY shot (has a
 * presigned image), or a PENDING placeholder with no image to redact yet.
 */
export function tileMode(shot: ScreenshotView): TileMode {
  if (shot.status === 'REDACTED') return 'redacted';
  if (shot.status === 'READY' && shot.url) return 'redactable';
  return 'pending';
}

/** Whether a tile can be opened full-size — needs a presigned full-res object behind it. */
export function isOpenable(shot: ScreenshotView): boolean {
  return tileMode(shot) === 'redactable' && Boolean(shot.fullUrl);
}

/**
 * The shots the lightbox can page through, in the order they are displayed. Redacted and
 * pending tiles are skipped: there is no image to show, and stepping onto one would look like
 * the viewer had broken it.
 */
export function openableShots(shots: ScreenshotView[]): ScreenshotView[] {
  return shots.filter(isOpenable);
}

/**
 * Index of the neighbouring shot for arrow-key paging, or null at the ends. Deliberately does
 * NOT wrap: silently jumping from the last capture of the day back to the first misreads as a
 * bug, and these are timestamped events where order carries meaning.
 */
export function stepIndex(count: number, current: number, delta: number): number | null {
  if (count === 0) return null;
  const next = current + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

/** `2026-08-14T12:43:47.000Z` → Dhaka wall-clock `18:43`. The grid and the lightbox caption share this. */
export function shotTime(timestamp: string): string {
  return clockOf(new Date(timestamp));
}
