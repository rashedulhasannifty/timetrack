import type { ActivityDailySummary } from '@timetrack/contracts';
import { ActivityDailyChart } from '../charts/ActivityDailyChart';
import {
  aggregateApps,
  aggregateCategories,
  toDailyActivityPoints,
  totalActiveMinutes,
  type CategorySlice,
} from '../../lib/activity-summary-view';

const CATEGORY_COLOR: Record<CategorySlice['category'], string> = {
  PRODUCTIVE: '#16a34a',
  NEUTRAL: '#a3a3a3',
  UNPRODUCTIVE: '#d97706',
};

const CATEGORY_LABEL: Record<CategorySlice['category'], string> = {
  PRODUCTIVE: 'Productive',
  NEUTRAL: 'Neutral',
  UNPRODUCTIVE: 'Unproductive',
};

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
    return <p className="text-sm text-neutral-500">No activity recorded in the last 7 days.</p>;
  }

  const points = toDailyActivityPoints(summaries, from, to);
  const apps = aggregateApps(summaries);
  const categories = aggregateCategories(summaries);
  const active = totalActiveMinutes(summaries);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-2xl font-light">{formatMinutes(active)}</span>
        <span className="ml-2 text-sm text-neutral-500">active · last 7 days (UTC)</span>
      </div>

      <ActivityDailyChart data={points} />

      <div>
        <h3 className="mb-3 text-sm font-medium text-neutral-900">Apps &amp; sites</h3>
        <ul className="flex flex-col gap-2">
          {apps.map((a) => (
            <li key={a.name} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm">{a.name}</span>
              <span className="h-2 flex-1 overflow-hidden rounded bg-neutral-100">
                <span
                  className="block h-full rounded bg-neutral-900"
                  style={{ width: `${a.pct}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-sm tabular-nums text-neutral-500">
                {formatMinutes(a.minutes)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium text-neutral-900">Category mix</h3>
        <span className="flex h-3 overflow-hidden rounded">
          {categories.map((c) => (
            <span
              key={c.category}
              style={{ width: `${c.pct}%`, background: CATEGORY_COLOR[c.category] }}
            />
          ))}
        </span>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-500">
          {categories.map((c) => (
            <span key={c.category} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: CATEGORY_COLOR[c.category] }}
              />
              {CATEGORY_LABEL[c.category]} {c.pct}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
