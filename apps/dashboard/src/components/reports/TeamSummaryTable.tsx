import type { TeamSummaryRow } from '@timetrack/contracts';
import { formatDuration } from '../../lib/format';

/** Per-user tracked time + activity % over the range. Same aggregate an employee sees of self. */
export function TeamSummaryTable({ rows }: { rows: TeamSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No tracked time in this range.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-2 font-medium">Name</th>
          <th className="py-2 font-medium">Tracked</th>
          <th className="py-2 font-medium">Activity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} className="border-b border-neutral-100">
            <td className="py-2">{r.name}</td>
            <td className="py-2 tabular-nums">{formatDuration(r.trackedSeconds)}</td>
            <td className="py-2">
              <span className="flex items-center gap-2">
                <span className="h-2 w-24 overflow-hidden rounded bg-neutral-100">
                  <span
                    className="block h-full rounded bg-neutral-900"
                    style={{ width: `${r.activityPct}%` }}
                  />
                </span>
                <span className="tabular-nums text-neutral-600">{r.activityPct}%</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
