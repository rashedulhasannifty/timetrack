import type { CategoryMix } from '../../lib/idle-view';

/**
 * The day's productive / neutral / unproductive split as one stacked rail. Sits under the
 * activity chart, which says how *busy* the day was but nothing about what kind of time it was.
 */
export function CategoryMixBar({ mix }: { mix: CategoryMix }) {
  if (mix.sampled === 0) {
    return (
      <p className="text-text-secondary text-caption m-0">No categorized samples on this day.</p>
    );
  }
  const segments = [
    { label: 'Productive', pct: mix.productivePct, color: 'var(--tt-accent)' },
    { label: 'Neutral', pct: mix.neutralPct, color: 'var(--tt-neutral)' },
    { label: 'Unproductive', pct: mix.unproductivePct, color: 'var(--tt-category-unproductive)' },
  ];
  return (
    <div>
      <div className="text-text-secondary text-caption mb-2 flex justify-between">
        <span>Category mix</span>
        <span className="tt-numeric">
          {mix.productivePct} / {mix.neutralPct} / {mix.unproductivePct}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${mix.productivePct}% productive, ${mix.neutralPct}% neutral, ${mix.unproductivePct}% unproductive`}
        className="flex h-1.5 overflow-hidden rounded-[3px]"
      >
        {segments.map((s) => (
          <span key={s.label} style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      <div className="text-text-secondary text-micro mt-2 flex gap-4">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-[2px]"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
