import type { ActivityBucket } from '../../lib/person-day-view';
import { CATEGORY_BG_CLASS } from './TimeRibbon';

const BAR_AREA_HEIGHT_PX = 104;
const UNTRACKED_BG_CLASS = 'bg-category-neutral/25';
const LABEL_EVERY = 3;
// Legibility floors (as % of the band): a tracked-but-low-activity hour stays clearly visible and
// distinct from an untracked hour, so a quiet day never reads as an empty chart.
const MIN_ACTIVE_PCT = 14;
const UNTRACKED_MARK_PCT = 5;

/**
 * One bar per hour bucket; height is proportional to `activityPct` (a flat, minimal
 * "no data" mark when null), colored by the bucket's dominant category. Shares the
 * category -> class map with TimeRibbon so the two visuals never drift apart.
 */
export function ActivityBars({ buckets }: { buckets: ActivityBucket[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-end gap-[2px]"
        style={{ height: BAR_AREA_HEIGHT_PX }}
        role="img"
        aria-label="Hourly activity"
      >
        {buckets.map((bucket, i) => {
          const isUntracked = bucket.category === 'UNTRACKED' || bucket.activityPct === null;
          const heightPct = isUntracked
            ? UNTRACKED_MARK_PCT
            : Math.max(MIN_ACTIVE_PCT, bucket.activityPct as number);
          const fillClass = isUntracked
            ? UNTRACKED_BG_CLASS
            : CATEGORY_BG_CLASS[
                bucket.category as Exclude<ActivityBucket['category'], 'UNTRACKED'>
              ];
          const title = isUntracked
            ? `${bucket.label}:00 · untracked`
            : `${bucket.label}:00 · ${bucket.activityPct}% active`;
          return (
            // h-full is load-bearing: the row sets `items-end`, so without an explicit height
            // this wrapper is sized by its content, and the bar's percentage height resolves
            // against an indefinite height -> 0px. Every bar rendered invisible.
            <div key={i} className="flex h-full flex-1 items-end" title={title}>
              <div
                className={`w-full rounded-t-[3px] ${fillClass}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* x-axis labels: every few hours */}
      <div className="flex text-caption text-text-secondary tt-numeric">
        {buckets.map((bucket, i) => (
          <span key={i} className="flex-1 text-center">
            {i % LABEL_EVERY === 0 ? bucket.label : ''}
          </span>
        ))}
      </div>

      {/* Legend. No "screen captures" entry: these bars draw no capture ticks — those belong
          to the ribbon above, and a legend that names a mark the chart never draws sends the
          reader hunting for something that isn't there. */}
      <div className="flex flex-wrap gap-3.5 text-caption text-text-secondary">
        <LegendSwatch className="bg-category-productive">Productive</LegendSwatch>
        <LegendSwatch className="bg-category-neutral">Neutral</LegendSwatch>
        <LegendSwatch className="bg-category-unproductive">Unproductive</LegendSwatch>
        <LegendSwatch className={UNTRACKED_BG_CLASS}>No data</LegendSwatch>
      </div>
    </div>
  );
}

function LegendSwatch({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-[8px] w-[8px] flex-none rounded-[2px] ${className}`} />
      {children}
    </span>
  );
}
