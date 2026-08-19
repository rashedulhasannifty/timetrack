import type { IdleEvent } from '@timetrack/contracts';
import { formatDuration, formatTimeRange } from './format';

/**
 * Pure view-transform for the self-view's idle panel. No React, no I/O.
 *
 * Read-only by design: an idle period is resolved on the Mac, in the "away for X minutes —
 * keep or discard?" prompt the client raises on resume. There is no dashboard mutation for it,
 * so this reports what the client decided rather than offering a second place to decide it.
 */
export interface IdlePeriodRow {
  id: string;
  range: string;
  duration: string;
  outcome: string;
  unresolved: boolean;
}

const OUTCOME: Record<IdleEvent['resolvedAction'], string> = {
  KEPT: 'Kept as tracked time',
  DISCARDED: 'Discarded — the overlapping time was dropped',
  UNRESOLVED: 'Not answered on the Mac yet',
};

export function idlePeriodRows(events: IdleEvent[]): IdlePeriodRow[] {
  return [...events]
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .map((e) => ({
      id: e.id,
      range: formatTimeRange(e.startTime, e.endTime),
      duration: formatDuration(
        Math.max(0, (Date.parse(e.endTime) - Date.parse(e.startTime)) / 1000),
      ),
      outcome: OUTCOME[e.resolvedAction],
      unresolved: e.resolvedAction === 'UNRESOLVED',
    }));
}
