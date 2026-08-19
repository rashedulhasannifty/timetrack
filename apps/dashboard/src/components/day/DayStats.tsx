import { StatCard } from '../ui/StatCard';
import { formatDuration } from '../../lib/format';
import type { PersonDayViewModel } from '../../lib/person-day-view';

/**
 * Hero stat row for the day view: Tracked / Active / Untracked. Reuses the existing `StatCard`
 * KPI tile (tt-numeric value, caption label) rather than inventing new hero typography. Each
 * tile carries the line that qualifies the figure — a percentage with nothing under it invites
 * the reader to guess its denominator.
 */
export function DayStats({
  stats,
  entryCount,
}: {
  stats: PersonDayViewModel['stats'];
  entryCount: number;
}) {
  const { trackedSeconds, untrackedSeconds, activePct } = stats;
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
      <StatCard
        label="Tracked"
        value={formatDuration(trackedSeconds)}
        hint={`across ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`}
      />
      <StatCard
        label="Active"
        value={activePct == null ? '—' : `${activePct}%`}
        hint="keyboard & mouse"
      />
      <StatCard
        label="Untracked"
        value={formatDuration(untrackedSeconds)}
        hint="inside the working day"
      />
    </div>
  );
}
