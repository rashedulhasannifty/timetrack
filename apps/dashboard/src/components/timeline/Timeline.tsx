import type { TimeEntry } from '@timetrack/contracts';
import { formatTimeRange } from '../../lib/format';

/**
 * A person's time entries as a vertical list. Types come from @timetrack/contracts —
 * never a hand-written response interface (CLAUDE.md §4).
 */
export function Timeline({ entries }: { entries: TimeEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-neutral-500">No entries in range.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium">{formatTimeRange(e.startTime, e.endTime)}</span>
          {e.note ? <span className="ml-2 text-neutral-500">{e.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
