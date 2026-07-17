import type { Screenshot } from '@timetrack/contracts';

export type TileMode = 'redactable' | 'redacted' | 'pending';

/**
 * How a screenshot tile renders: a REDACTED tombstone, a redactable READY shot (has a
 * presigned image), or a PENDING placeholder with no image to redact yet.
 */
export function tileMode(shot: Screenshot): TileMode {
  if (shot.status === 'REDACTED') return 'redacted';
  if (shot.status === 'READY' && shot.url) return 'redactable';
  return 'pending';
}
