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
  | 'id'
  | 'status'
  | 'url'
  | 'fullUrl'
  | 'redactedReason'
  | 'timestamp'
  | 'captureGroupId'
  | 'displayIndex'
  | 'displayCount'
>;

export function toScreenshotView(s: Screenshot): ScreenshotView {
  return {
    id: s.id,
    status: s.status,
    url: s.url,
    fullUrl: s.fullUrl,
    redactedReason: s.redactedReason,
    timestamp: s.timestamp,
    captureGroupId: s.captureGroupId,
    displayIndex: s.displayIndex,
    displayCount: s.displayCount,
  };
}

/** One capture instant: every display grabbed in the same tick, shown together. */
export interface ShotGroup {
  key: string;
  /** Shared by the whole group — one tick stamps one capture time. */
  timestamp: string;
  shots: ScreenshotView[];
  /**
   * Displays the client tried to capture. Null when the client didn't say (any capture taken
   * before multi-display support). When it exceeds `shots.length`, a display failed to capture
   * and the group says so rather than passing itself off as the whole desk.
   */
  attempted: number | null;
}

/**
 * Group a day's captures by the tick that produced them, preserving the order they arrive in
 * (newest first, main display first within a tick).
 *
 * A shot with no `captureGroupId` becomes its own group. That is not a fallback so much as the
 * truth about those rows: before multi-display capture the client only ever recorded the main
 * display, so every one of them genuinely is a group of one.
 */
export function groupShots(shots: ScreenshotView[]): ShotGroup[] {
  const groups: ShotGroup[] = [];
  const byId = new Map<string, ShotGroup>();

  for (const shot of shots) {
    const existing = shot.captureGroupId ? byId.get(shot.captureGroupId) : undefined;
    if (existing) {
      existing.shots.push(shot);
      // Trust the largest count any member reports: a group is only ever under-reported when a
      // display drops out mid-tick, never over-reported.
      if (shot.displayCount !== null) {
        existing.attempted = Math.max(existing.attempted ?? 0, shot.displayCount);
      }
      continue;
    }
    // Keyed by id, not group id, so ungrouped legacy rows can never collide with each other.
    const group: ShotGroup = {
      key: shot.captureGroupId ?? shot.id,
      timestamp: shot.timestamp,
      shots: [shot],
      attempted: shot.displayCount,
    };
    groups.push(group);
    if (shot.captureGroupId) byId.set(shot.captureGroupId, group);
  }
  return groups;
}

/**
 * How a group labels itself: "2 displays", or "1 of 2 displays" when one failed to capture.
 * Null for an ordinary single-display capture, which needs no label at all.
 */
export function groupLabel(group: ShotGroup): string | null {
  const captured = group.shots.length;
  const attempted = group.attempted ?? captured;
  if (attempted <= 1 && captured <= 1) return null;
  if (captured < attempted) return `${captured} of ${attempted} displays`;
  return `${captured} displays`;
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

/**
 * What a single tile says under itself. Inside a multi-display group the shared capture time is
 * already on the group header, so the tile names its display instead — otherwise every tile in
 * the group would repeat the same clock time.
 */
export function tileCaption(shot: ScreenshotView, group: ShotGroup): string {
  if (group.shots.length <= 1 || shot.displayIndex === null) return shotTime(shot.timestamp);
  return `Display ${shot.displayIndex + 1}`;
}

/**
 * How a shot names itself outside its group: the capture time, plus the display when the client
 * recorded one. The lightbox pages across the whole day, so without the display two shots from
 * the same tick would read as the same capture twice.
 */
export function shotDescription(shot: ScreenshotView): string {
  const time = shotTime(shot.timestamp);
  return shot.displayIndex === null ? time : `${time} · Display ${shot.displayIndex + 1}`;
}
