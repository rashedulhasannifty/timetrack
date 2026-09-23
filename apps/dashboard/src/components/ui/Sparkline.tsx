import { sparklinePath } from '../../lib/sparkline';

/**
 * A bare trend line for KPI tiles. Decorative: the number beside it carries the meaning, so
 * it is hidden from assistive tech rather than given a label nobody can act on.
 */
export function Sparkline({
  data,
  color = 'var(--tt-accent)',
  width = 60,
  height = 16,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const d = sparklinePath(data, width, height);
  if (!d) return null;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
