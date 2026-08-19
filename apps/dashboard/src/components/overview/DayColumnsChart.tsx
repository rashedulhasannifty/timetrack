'use client';

import { useState } from 'react';
import type { DayColumn } from '../../lib/overview-view';

/**
 * Hours per day, one bar per day in the range. Weekends are drawn in the separator colour
 * rather than the accent so a low weekend reads as "nobody worked" rather than "a bad day".
 *
 * The tooltip is what makes the productive share visible without a second chart: hovering a
 * bar reports that day's hours and its productive percentage.
 */
export function DayColumnsChart({ columns }: { columns: DayColumn[] }) {
  const [hot, setHot] = useState<number | null>(null);
  const active = hot === null ? null : columns[hot];

  return (
    <div className="relative">
      {active ? (
        <div
          className="bg-hero text-hero-text pointer-events-none absolute -top-2 z-10 flex flex-col gap-px whitespace-nowrap rounded-[9px] px-[11px] py-[7px]"
          style={{
            left: `${Math.min(86, Math.max(0, (hot! / Math.max(1, columns.length - 1)) * 100 - 7))}%`,
            boxShadow: '0 8px 24px -8px rgba(0,0,0,.35)',
          }}
        >
          <span className="tt-numeric text-micro font-bold">{active.label}</span>
          <span className="tt-numeric text-hero-dim text-micro">
            {active.hours}h tracked · {active.productivePct}% productive
          </span>
        </div>
      ) : null}
      <div className="flex h-[150px] items-end gap-1" onMouseLeave={() => setHot(null)}>
        {columns.map((c, i) => (
          <div
            key={c.day}
            className={`flex h-full flex-1 items-end rounded-[4px] ${hot === i ? 'bg-tint' : ''}`}
            onMouseEnter={() => setHot(i)}
          >
            <div
              className="w-full rounded-[4px]"
              style={{
                // A day with tracked time never collapses to nothing: a 1% floor keeps the
                // bar visible so an almost-empty day is distinguishable from an empty one.
                height: `${c.hours > 0 ? Math.max(1, c.heightPct) : 0}%`,
                background: c.weekend ? 'var(--tt-separator)' : 'var(--tt-accent)',
                opacity: c.weekend || hot === i ? 1 : 0.55 + (c.heightPct / 100) * 0.45,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
