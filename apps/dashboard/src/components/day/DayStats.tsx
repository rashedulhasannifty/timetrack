import { StatCard } from '../ui/StatCard';
import { formatDuration } from '../../lib/format';
import type { PersonDayViewModel } from '../../lib/person-day-view';

/**
 * Hero stat row for the day view: Tracked / Active / Productive / Untracked. Reuses the shared
 * `StatCard` KPI tile rather than inventing new hero typography.
 *
 * Each value renders an em dash rather than 0% when its source is absent — a day with no
 * samples has an unknown activity level, not a zero one.
 */
export function DayStats({ stats }: { stats: PersonDayViewModel['stats'] }) {
  const { trackedSeconds, untrackedSeconds, activePct, productivePct } = stats;
  return (
    <div className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      <StatCard label="Tracked" value={formatDuration(trackedSeconds)} />
      <StatCard label="Activity" value={activePct == null ? '—' : `${activePct}%`} />
      <StatCard label="Productive" value={productivePct == null ? '—' : `${productivePct}%`} />
      <StatCard label="Untracked" value={formatDuration(untrackedSeconds)} />
    </div>
  );
}
