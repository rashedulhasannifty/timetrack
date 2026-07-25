export interface BarMeterProps {
  label: React.ReactNode;
  value: string;
  fills: { pct: number; color: string }[];
}

/**
 * A horizontal meter showing a label, value, and one or more colored fill segments.
 * Static, server-renderable component with no client interaction.
 */
export function BarMeter({ label, value, fills }: BarMeterProps) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] flex-1 truncate">{label}</span>
        <span className="text-[13px] tt-numeric text-text-secondary">{value}</span>
      </div>
      <div className="flex h-[6px] overflow-hidden rounded-[3px] bg-separator">
        {fills.map((f, i) => (
          <div
            key={i}
            style={{
              width: `${f.pct}%`,
              backgroundColor: f.color,
            }}
            className="h-full"
          />
        ))}
      </div>
    </div>
  );
}
