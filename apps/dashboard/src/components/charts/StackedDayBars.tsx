export interface StackedDayBarsDayLetter {
  letter: string;
  weekend: boolean;
}

export interface StackedDayBarsProps {
  /** Productive % per day (0-100); the remainder renders as the unproductive segment. */
  values: number[];
  dayLetters: StackedDayBarsDayLetter[];
}

const H = 170;

/** Static per-day productive/unproductive stacked bar chart. */
export function StackedDayBars({ values, dayLetters }: StackedDayBarsProps) {
  const n = values.length;
  const bw = n > 0 ? 600 / n : 0;
  const base = H - 4;

  return (
    <div>
      <svg viewBox="0 0 640 170" width="100%" height={H} preserveAspectRatio="none" role="img">
        {values.map((v, i) => {
          const x = i * bw + bw * 0.2;
          const w = bw * 0.6;
          const gh = (v / 100) * (H - 12);
          const rh = ((100 - v) / 100) * (H - 12);
          return (
            <g key={i}>
              <rect x={x} y={base - gh - rh} width={w} height={gh} rx={2} fill="var(--tt-good)" />
              <rect x={x} y={base - rh} width={w} height={rh} fill="var(--tt-destructive)" />
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 0, marginTop: 4 }}>
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
    </div>
  );
}
