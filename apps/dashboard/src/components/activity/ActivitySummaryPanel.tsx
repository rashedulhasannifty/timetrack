import type { ActivityDailySummary } from '@timetrack/contracts';
import { ActivityDailyChart } from '../charts/ActivityDailyChart';
import { BarMeter } from '../charts/BarMeter';
import { CategoryMixBar } from '../charts/CategoryMixBar';
import { Card } from '../ui/Card';
import {
  aggregateApps,
  aggregateCategories,
  toDailyActivityPoints,
  totalActiveMinutes,
} from '../../lib/activity-summary-view';

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * PRD §4.3 / §6.3 — the last-7-days activity rollup, rendered identically for the employee
 * (self) and their manager. Same endpoint, same component: symmetric transparency.
 */
export function ActivitySummaryPanel({
  summaries,
  from,
  to,
}: {
  summaries: ActivityDailySummary[];
  from: string;
  to: string;
}) {
  if (summaries.length === 0) {
    return (
      <p className="text-text-secondary text-body">No activity recorded in the last 7 days.</p>
    );
  }

  const points = toDailyActivityPoints(summaries, from, to);
  const apps = aggregateApps(summaries);
  const categories = aggregateCategories(summaries);
  const active = totalActiveMinutes(summaries);

  const pctByCategory = Object.fromEntries(categories.map((c) => [c.category, c.pct]));

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <Card padding="md">
        <div className="flex flex-col gap-3.5">
          <div className="text-[48px] font-semibold leading-[1.1] tracking-[-0.02em] tt-numeric">
            {active}
          </div>
          <div className="text-caption text-text-secondary">active minutes · last 7 days (UTC)</div>
          <ActivityDailyChart data={points} />
        </div>
      </Card>

      <Card padding="md">
        <div className="flex flex-col gap-3.5">
          <h3 className="text-text text-label font-semibold">My top apps &amp; sites</h3>
          <div className="flex flex-col gap-3">
            {apps.map((a) => (
              <BarMeter
                key={a.name}
                label={a.name}
                value={formatMinutes(a.minutes)}
                fills={[{ pct: a.pct, color: 'var(--tt-accent)' }]}
              />
            ))}
          </div>

          <div className="border-separator flex flex-col gap-2 border-t pt-3.5">
            <h3 className="text-text text-label font-semibold">Category mix</h3>
            <CategoryMixBar
              productive={pctByCategory.PRODUCTIVE ?? 0}
              neutral={pctByCategory.NEUTRAL ?? 0}
              unproductive={pctByCategory.UNPRODUCTIVE ?? 0}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
