'use client';

import { useState } from 'react';
import { lineGrid, linePoints, nearestIndex } from '../../lib/charts';

export interface LineChartDayLetter {
  letter: string;
  weekend: boolean;
}

export interface LineChartProps {
  values: number[];
  max: number;
  axis: string[];
  dayLetters: LineChartDayLetter[];
  color: string;
  /** Unit suffix appended to the hovered value in the tooltip (e.g. `'h'`). A plain
   *  string rather than a formatter function so this client component can be rendered
   *  from a Server Component — functions can't cross the RSC boundary. */
  unit: string;
  /** Per-point date string shown in the tooltip; same length as `values`. */
  labels: string[];
}

interface HoverState {
  i: number;
  left: number;
}

/** Interactive line chart: polyline + hover tooltip + dashed cursor + axis + day-letter row. */
export function LineChart({ values, max, axis, dayLetters, color, unit, labels }: LineChartProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const lp = linePoints(values, max);
  const grid = lineGrid(axis);
  const step = values.length > 1 ? 600 / (values.length - 1) : 600;
  const cursorX = hover ? r1(hover.i * step) : 0;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = nearestIndex(ratio, values.length);
    const left = values.length > 1 ? r.width * (i / (values.length - 1)) : r.width / 2;
    setHover({ i, left });
  }

  const hoverValue = hover ? values[hover.i] : undefined;
  const hoverLabel = hover ? labels[hover.i] : undefined;

  return (
    <div className="relative" style={{ marginTop: 8 }} onMouseLeave={() => setHover(null)}>
      <svg
        viewBox="0 0 640 170"
        width="100%"
        height={170}
        preserveAspectRatio="none"
        role="img"
        aria-label="Line chart"
        onMouseMove={onMove}
        style={{ display: 'block', cursor: 'crosshair' }}
      >
        {grid.map((g) => (
          <line
            key={g.y}
            x1={0}
            y1={g.y}
            x2={640}
            y2={g.y}
            stroke="var(--tt-separator)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polyline
          points={lp.points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        {lp.nodes.map((n, i) => (
          <circle
            key={i}
            cx={n.x}
            cy={n.y}
            r={2.5}
            fill="var(--tt-surface-raised)"
            stroke={color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hover !== null && (
          <line
            x1={cursorX}
            y1={0}
            x2={cursorX}
            y2={170}
            stroke="var(--tt-text-secondary)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            opacity={0.7}
          />
        )}
      </svg>
      {grid.map((g) => (
        <span
          key={g.y}
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            top: g.y,
            transform: 'translateY(-50%)',
            fontSize: 10,
            lineHeight: 1,
            color: 'var(--tt-text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            background: 'var(--tt-surface-raised)',
            padding: '0 2px',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {g.label}
        </span>
      ))}
      <div style={{ display: 'flex', gap: 0, marginTop: 4, paddingRight: 36 }}>
        {dayLetters.map((d, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 9,
              fontVariantNumeric: 'tabular-nums',
              color: d.weekend ? 'var(--tt-destructive)' : 'var(--tt-text-secondary)',
            }}
          >
            {d.letter}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: -6,
            left: Math.max(0, hover.left - 44),
            background: 'var(--tt-surface-raised)',
            border: '1px solid var(--tt-separator)',
            boxShadow: 'var(--tt-elevation-2)',
            borderRadius: 8,
            padding: '6px 10px',
            pointerEvents: 'none',
            zIndex: 5,
            color: 'var(--tt-text)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--tt-text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {hoverLabel ?? ''}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {hoverValue !== undefined ? `${hoverValue}${unit}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
