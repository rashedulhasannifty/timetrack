import type { DayCategory } from '../../lib/person-day-view';
import type { PersonDayViewModel } from '../../lib/person-day-view';
import { formatDuration, formatTimeRange } from '../../lib/format';

/**
 * Category -> Tailwind background-color class. The single source of truth for the
 * productive/neutral/unproductive fill used by both the ribbon blocks and the
 * activity bars (imported by ActivityBars.tsx) — no new palette, just the
 * existing `--color-category-*` tokens from globals.css.
 */
export const CATEGORY_BG_CLASS: Record<DayCategory, string> = {
  PRODUCTIVE: 'bg-category-productive',
  NEUTRAL: 'bg-category-neutral',
  UNPRODUCTIVE: 'bg-category-unproductive',
};

const RIBBON_HEIGHT_PX = 40;
const MIN_TRACK_WIDTH_PX = 640;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The signature day-view element: a single horizontal track of the day's window,
 * spanning `startPct..startPct+widthPct` for each tracked block. All geometry
 * (positions, widths) is pre-computed by `personDayView` — this component only
 * reads the `%` fields and paints them. Hover detail rides the native `title`
 * tooltip so the component stays a Server Component (no client JS).
 */
export function TimeRibbon({ ribbon }: { ribbon: PersonDayViewModel['ribbon'] }) {
  const { tracked, untracked, captures, hourTicks } = ribbon;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: MIN_TRACK_WIDTH_PX }}>
        {/* Hour ticks + labels */}
        <div className="relative h-4 text-caption text-text-secondary tt-numeric">
          {hourTicks.map((tick, i) => (
            <span key={i} className="absolute -translate-x-1/2" style={{ left: `${tick.atPct}%` }}>
              {tick.label}
            </span>
          ))}
        </div>

        {/* The track itself */}
        <div
          className="border-separator bg-surface relative overflow-hidden rounded-[6px] border"
          style={{ height: RIBBON_HEIGHT_PX }}
        >
          {/* Untracked gaps — hatched muted band */}
          {untracked.map((gap, i) => (
            <div
              key={i}
              className="bg-category-neutral/15 absolute inset-y-0"
              style={{
                left: `${gap.startPct}%`,
                width: `${gap.widthPct}%`,
                backgroundImage:
                  'repeating-linear-gradient(45deg, var(--tt-separator) 0, var(--tt-separator) 1px, transparent 1px, transparent 6px)',
              }}
            />
          ))}

          {/* Tracked blocks */}
          {tracked.map((block) => {
            const range = formatTimeRange(
              iso(block.startMs),
              block.endMs === null ? null : iso(block.endMs),
            );
            const duration =
              block.endMs !== null
                ? formatDuration((block.endMs - block.startMs) / 1000)
                : block.running
                  ? 'running'
                  : 'ongoing';
            return (
              <div
                key={block.id}
                title={`${block.label} · ${range} · ${duration}`}
                className={`absolute inset-y-0 flex items-center gap-1 overflow-hidden px-1 ${CATEGORY_BG_CLASS[block.category]}`}
                style={{ left: `${block.startPct}%`, width: `${block.widthPct}%` }}
              >
                <span className="h-[6px] w-[6px] flex-none rounded-full bg-white/70" />
              </div>
            );
          })}

          {/* Capture marks — thin 2px ticks on top of everything */}
          {captures.map((mark, i) => (
            <div
              key={i}
              className="bg-surface-raised/80 absolute inset-y-0 w-[2px]"
              style={{ left: `${mark.atPct}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
