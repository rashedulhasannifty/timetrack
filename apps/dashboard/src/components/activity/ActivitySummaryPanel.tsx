import type { ActivityDailySummary } from '@timetrack/contracts';
import { ActivityDailyChart } from '../charts/ActivityDailyChart';
import {
  aggregateApps,
  aggregateCategories,
  toDailyActivityPoints,
  totalActiveMinutes,
  type CategorySlice,
} from '../../lib/activity-summary-view';

// Design palette (indigo / gray / orange), routed through the shared tokens so the hue and the
// dark-mode shift come from one source (matches the macOS client's category colors).
const CATEGORY_COLOR: Record<CategorySlice['category'], string> = {
  PRODUCTIVE: 'var(--color-category-productive)',
  NEUTRAL: 'var(--color-category-neutral)',
  UNPRODUCTIVE: 'var(--color-category-unproductive)',
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
    return (
      <p className="text-text-secondary text-body">No activity recorded in the last 7 days.</p>
    );
  }

  const points = toDailyActivityPoints(summaries, from, to);
  const apps = aggregateApps(summaries);
  const categories = aggregateCategories(summaries);
  const active = totalActiveMinutes(summaries);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="tt-numeric text-h2 font-light">{formatMinutes(active)}</span>
        <span className="text-text-secondary text-body ml-2">active · last 7 days (UTC)</span>
      </div>

      <ActivityDailyChart data={points} />

      <div>
        <h3 className="text-text text-label mb-3 font-medium">Apps &amp; sites</h3>
        <ul className="flex flex-col gap-2">
          {apps.map((a) => (
            <li key={a.name} className="flex items-center gap-3">
              <span className="text-body w-40 shrink-0 truncate">{a.name}</span>
              <span className="bg-separator h-2 flex-1 overflow-hidden rounded">
                <span className="bg-accent block h-full rounded" style={{ width: `${a.pct}%` }} />
              </span>
              <span className="tt-numeric text-text-secondary text-body w-16 shrink-0 text-right">
                {formatMinutes(a.minutes)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-text text-label mb-3 font-medium">Category mix</h3>
        <span className="flex h-3 overflow-hidden rounded">
          {categories.map((c) => (
            <span
              key={c.category}
              style={{ width: `${c.pct}%`, background: CATEGORY_COLOR[c.category] }}
            />
          ))}
        </span>
        <div className="text-text-secondary text-caption mt-2 flex flex-wrap gap-4">
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
