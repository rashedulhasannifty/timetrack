import type { CSSProperties } from 'react';

/**
 * The 4px rail that carries almost every proportion in the redesign — activity %, project
 * share, per-app time. One primitive rather than the six hand-rolled bars this replaced, so
 * the height, radius and track colour stay in step everywhere.
 *
 * `pct` is clamped to 0–100: an idle or activity percentage arriving slightly over 100 from a
 * rounding seam should saturate the rail, never overflow the track.
 */
export function Meter({
  pct,
  color = 'var(--tt-accent)',
  width,
  className = '',
  label,
}: {
  pct: number;
  color?: string;
  /** Fixed track width (px). Omit to fill the available space. */
  width?: number;
  className?: string;
  /** Accessible description; without it the rail is decorative and hidden from AT. */
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const style: CSSProperties = width === undefined ? { flex: 1 } : { width };
  const a11y = label
    ? ({
        role: 'meter' as const,
        'aria-valuenow': Math.round(clamped),
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-label': label,
      } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <span
      {...a11y}
      className={`bg-separator relative block h-1 overflow-hidden rounded-[2px] ${className}`.trim()}
      style={style}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-[2px]"
        style={{ width: `${clamped}%`, background: color }}
      />
    </span>
  );
}

/**
 * A meter split into two adjoining shares (productive vs unproductive) rather than one fill
 * over a track. Anything the two segments don't cover stays as track, which is what makes the
 * neutral remainder legible instead of silently rounding away.
 */
export function SplitMeter({
  segments,
  width,
  label,
}: {
  segments: ReadonlyArray<{ pct: number; color: string; opacity?: number }>;
  width?: number;
  label?: string;
}) {
  const style: CSSProperties = width === undefined ? { flex: 1 } : { width };
  return (
    <span
      aria-label={label}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      className="bg-separator flex h-1 overflow-hidden rounded-[2px]"
      style={style}
    >
      {segments.map((s, i) => (
        <span
          key={i}
          style={{
            width: `${Math.max(0, Math.min(100, s.pct))}%`,
            background: s.color,
            opacity: s.opacity,
          }}
        />
      ))}
    </span>
  );
}
