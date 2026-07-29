import { StatCard } from '../ui/StatCard';
import { formatDuration } from '../../lib/format';
import type { PersonDayViewModel } from '../../lib/person-day-view';

/**
 * Hero stat row for the day view: Tracked / Active / Untracked. Reuses the existing `StatCard`
 * KPI tile (tt-numeric value, caption label) rather than inventing new hero typography.
 */
export function DayStats({ stats }: { stats: PersonDayViewModel['stats'] }) {
  const { trackedSeconds, untrackedSeconds, activePct } = stats;
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      <StatCard label="Tracked" value={formatDuration(trackedSeconds)} />
      <StatCard label="Active" value={activePct == null ? '—' : `${activePct}%`} />
      <StatCard label="Untracked" value={formatDuration(untrackedSeconds)} />
    </div>
  );
}
