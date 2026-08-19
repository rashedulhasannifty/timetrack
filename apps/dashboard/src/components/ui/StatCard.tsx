import { Card } from './Card';
import { IconInfo } from './icons';

type Bar = { pct: number; color: string; caption: string; href?: string };

/** KPI tile: label (+optional ⓘ), big tabular value, optional progress bar with caption/link. */
export function StatCard({
  label,
  value,
  info = false,
  hint,
  bar,
}: {
  label: string;
  value: string;
  info?: boolean;
  /** One-line context under the value — the handoff's stat tiles always carry one. */
  hint?: string;
  bar?: Bar;
}) {
  return (
    <Card padding="none" className="flex flex-col gap-[5px] px-[18px] py-4">
      <div className="flex items-start gap-1.5">
        <div className="text-caption text-text-secondary flex-1">{label}</div>
        {info ? (
          <IconInfo
            width={13}
            height={13}
            className="text-text-secondary mt-[3px] flex-none opacity-60"
          />
        ) : null}
      </div>
      <div className="tt-numeric text-[24px] font-semibold leading-[1.1] tracking-[-0.02em]">
        {value}
      </div>
      {hint ? <div className="text-caption text-text-secondary">{hint}</div> : null}
      {bar ? (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <div className="bg-separator h-[5px] overflow-hidden rounded-[3px]">
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${bar.pct}%`, background: bar.color }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-caption text-text-secondary tt-numeric">{bar.caption}</span>
            {bar.href ? (
              <a href={bar.href} className="text-caption ml-auto">
                View details
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
