import type { ReactNode } from 'react';
import type { IdleRow } from '../../lib/idle-view';
import { Badge } from '../ui/Badge';
import { formatDuration } from '../../lib/format';

const TONE_BADGE = {
  good: 'good',
  neutral: 'neutral',
  warning: 'warning',
} as const;

const LABEL = {
  KEPT: 'Kept',
  DISCARDED: 'Discarded',
  UNRESOLVED: 'Unresolved',
} as const;

/**
 * The day's idle periods and how each was answered.
 *
 * `action` is a slot so the same panel serves both surfaces: on /me it renders the Keep/Discard
 * control, and on a manager's view of someone else it renders nothing. That asymmetry is the
 * API's, not a policy choice here -- `POST /idle-events` attributes the row to the caller, so a
 * manager physically cannot resolve another person's period.
 */
export function IdlePanel({
  rows,
  action,
}: {
  rows: IdleRow[];
  /** Per-row control. Omit for a read-only (manager) view. */
  action?: (row: IdleRow) => ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-text-secondary text-caption">
        No idle periods over the threshold on this day.
      </p>
    );
  }
  return (
    <>
      <p className="text-text-secondary text-caption m-0 mb-3 max-w-[620px] text-pretty">
        {action
          ? 'Resolving a period tells your manager what it was. Nothing is deleted either way — discarding drops the overlapping tracked time, it does not erase the record.'
          : 'Resolved on this person’s Mac app, or from their own My time page. Nothing is deleted either way.'}
      </p>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => (
          <li key={r.id} className="border-separator flex items-center gap-4 border-t py-3">
            <span className="tt-numeric text-text-secondary w-[112px] flex-none text-caption">
              {r.range}
            </span>
            <span className="tt-numeric w-14 flex-none text-[13px] font-bold">
              {formatDuration(r.durationSeconds)}
            </span>
            <span className="text-text-secondary flex-1 text-[13px]">{r.note}</span>
            <Badge tone={TONE_BADGE[r.tone]}>{LABEL[r.outcome]}</Badge>
            {action ? action(r) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
