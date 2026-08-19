import { Badge } from '../ui/Badge';
import type { IdlePeriodRow } from '../../lib/idle-view';

/** Read-only list of the day's idle periods and how the Mac client resolved each one. */
export function IdlePeriods({ rows }: { rows: IdlePeriodRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-secondary text-body">
        No idle periods over the threshold were recorded today.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {rows.map((row) => (
        <li key={row.id} className="border-separator flex items-center gap-4 border-t py-3">
          <span className="tt-numeric text-text-secondary w-28 flex-none text-caption">
            {row.range}
          </span>
          <span className="tt-numeric w-14 flex-none text-[13px] font-medium">{row.duration}</span>
          <span className="text-text-secondary flex-1 text-[13px]">{row.outcome}</span>
          {row.unresolved ? <Badge tone="warning">Unresolved</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
