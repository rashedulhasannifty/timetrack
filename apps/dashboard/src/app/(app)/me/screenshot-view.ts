import type { Screenshot } from '@timetrack/contracts';

export type TileMode = 'redactable' | 'redacted' | 'pending';

/**
 * The subset of Screenshot fields the client panel actually renders. Keeps the presigned
 * full-res URL (`fullUrl`) and internal object paths (`storageKey`, `thumbnailKey`) out of
 * the RSC payload shipped to the browser.
 */
export type ScreenshotView = Pick<
  Screenshot,
  'id' | 'status' | 'url' | 'redactedReason' | 'timestamp'
>;

export function toScreenshotView(s: Screenshot): ScreenshotView {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
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
