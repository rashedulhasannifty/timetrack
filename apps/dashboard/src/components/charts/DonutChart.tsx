'use client';

import { useState } from 'react';
import { donutSegments } from '../../lib/charts';

export interface DonutChartItem {
  label: string;
  value: number;
  color: string;
  /** Pre-formatted string shown in the legend's right column (e.g. a duration). */
  display: string;
}

export interface DonutChartProps {
  items: DonutChartItem[];
  centerValue: string;
  centerLabel: string;
}

/** Donut ring + centered value/label + legend, built on the shared donutSegments geometry. */
export function DonutChart({ items, centerValue, centerLabel }: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const segments = donutSegments(items);

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[180px] w-[180px] flex-none">
        <svg
          viewBox="0 0 180 180"
          width={180}
          height={180}
          role="img"
          aria-label="Hours by project"
        >
          <circle
            cx={90}
            cy={90}
            r={66}
            fill="none"
            stroke="var(--tt-separator)"
            strokeWidth={28}
            opacity={0.35}
          />
          {segments.map((seg, i) => {
            const item = items[i];
            if (!item) {
              return null;
            }
            return (
              <circle
                key={item.label}
                cx={90}
                cy={90}
                r={66}
                fill="none"
                stroke={item.color}
                strokeWidth={hovered === i ? 34 : 28}
                strokeDasharray={seg.dash}
                strokeDashoffset={seg.offset}
                transform="rotate(-90 90 90)"
                style={{ cursor: 'pointer', transition: 'stroke-width .15s ease' }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div
            className="tt-numeric text-[18px] font-semibold"
            style={{ letterSpacing: '-0.02em' }}
          >
            {centerValue}
          </div>
          <div className="text-text-secondary text-[12px]">{centerLabel}</div>
        </div>
      </div>
      <ul className="m-0 flex min-w-[180px] flex-1 list-none flex-col gap-2.5 p-0">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5 text-[13px]">
            <span
              className="h-[9px] w-[9px] flex-none rounded-full"
              style={{ background: item.color }}
            />
            <span className="text-text flex-1">{item.label}</span>
            <span className="tt-numeric text-text-secondary">{item.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
