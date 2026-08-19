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
 * Read-only on purpose: the keep/discard prompt lives on the macOS client and syncs up, and
 * there is no endpoint to resolve one from here. The copy says that rather than offering a
 * button that cannot work.
 */
export function IdlePanel({ rows }: { rows: IdleRow[] }) {
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
        Idle stretches are answered on the Mac app when it prompts you. Nothing is deleted either
        way — a discarded period is removed from the day’s tracked total, not erased.
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
          </li>
        ))}
      </ul>
    </>
  );
}
