import { gaugeArc } from '../../lib/charts';

export interface GaugeProps {
  pct: number;
  color: string;
  label?: string;
}

/** Static arc dial (135°-start, ~245° sweep) showing a rounded percentage in the center. */
export function Gauge({ pct, color, label }: GaugeProps) {
  const arc = gaugeArc(pct);

  return (
    <div className="relative h-[72px] w-[72px]">
      <svg viewBox="0 0 72 72" width={72} height={72} role="img" aria-label={label ?? `${pct}%`}>
        <circle
          cx={36}
          cy={36}
          r={28}
          fill="none"
          stroke="var(--tt-separator)"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={arc.track}
          transform="rotate(135 36 36)"
        />
        <circle
          cx={36}
          cy={36}
          r={28}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={arc.dash}
          transform="rotate(135 36 36)"
        />
      </svg>
      <div className="tt-numeric absolute inset-0 flex items-center justify-center text-[15px] font-semibold">
        {Math.round(pct)}%
      </div>
    </div>
  );
}
