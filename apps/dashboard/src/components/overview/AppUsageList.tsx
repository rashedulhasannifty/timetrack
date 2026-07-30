import type { AppUsageItem } from '../../lib/overview-view';
import { formatDuration } from '../../lib/format';

/** Presentational website/app usage list: name · length-bar · tabular time. */
export function AppUsageList({ items }: { items: AppUsageItem[] }) {
  if (items.length === 0) {
    return <p className="text-text-secondary text-body">No data in this range.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((it) => (
        <li key={it.appName} className="flex items-center gap-3">
          <span className="text-text flex-1 truncate text-[13px]">{it.appName}</span>
          <span className="bg-separator relative h-[6px] w-[120px] overflow-hidden rounded-[3px]">
            <span
              className="absolute inset-y-0 left-0 rounded-[3px]"
              style={{ width: `${it.pct}%`, background: 'var(--tt-accent)' }}
            />
          </span>
          <span className="tt-numeric text-text-secondary w-14 text-right text-caption">
            {formatDuration(it.seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}
