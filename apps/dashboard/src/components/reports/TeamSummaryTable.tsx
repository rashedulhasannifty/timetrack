import type { TeamSummaryRow } from '@timetrack/contracts';
import { formatDuration } from '../../lib/format';

/** Per-user tracked time + activity % over the range. Same aggregate an employee sees of self. */
export function TeamSummaryTable({ rows }: { rows: TeamSummaryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-text-secondary text-body">No tracked time in this range.</p>;
  }
  return (
    <table className="w-full text-body">
      <thead>
        <tr className="border-separator text-text-secondary border-b text-left">
          <th className="py-2 font-medium">Name</th>
          <th className="py-2 font-medium">Tracked</th>
          <th className="py-2 font-medium">Activity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} className="border-separator border-b">
            <td className="py-2">{r.name}</td>
            <td className="tt-numeric py-2">{formatDuration(r.trackedSeconds)}</td>
            <td className="py-2">
              <span className="flex items-center gap-2">
                <span className="bg-separator h-2 w-24 overflow-hidden rounded">
                  <span
                    className="bg-accent block h-full rounded"
                    style={{ width: `${r.activityPct}%` }}
                  />
                </span>
                <span className="tt-numeric text-text-secondary">{r.activityPct}%</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
