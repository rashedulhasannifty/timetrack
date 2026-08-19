import type { ReactNode } from 'react';
import { Card } from './Card';
import { IconInfo } from './icons';

type Bar = { pct: number; color: string; caption: string; href?: string };

/**
 * KPI tile: label (+optional icon chip / ⓘ), big tabular value, optional delta line, and an
 * optional progress bar pinned to the bottom edge so a row of tiles keeps its rails aligned
 * even when one of them carries an extra line of text.
 */
export function StatCard({
  label,
  value,
  info = false,
  icon,
  delta,
  bar,
}: {
  label: string;
  value: string;
  info?: boolean;
  /** Small line-icon shown in a tinted chip beside the label. */
  icon?: ReactNode;
  /** Comparison line under the value, e.g. "+2 pts vs prev". */
  delta?: { text: string; tone?: 'up' | 'down' | 'flat' };
  bar?: Bar;
}) {
  const deltaTone =
    delta?.tone === 'up'
      ? 'text-good'
      : delta?.tone === 'down'
        ? 'text-destructive'
        : 'text-text-secondary';
  return (
    <Card padding="none" className="flex min-h-[136px] flex-col p-[22px]">
      <div className="flex items-start gap-2">
        {icon ? (
          <span className="bg-tint text-accent inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg">
            {icon}
          </span>
        ) : null}
        <div className="text-label text-text-secondary flex-1 self-center">{label}</div>
        {info ? (
          <IconInfo
            width={13}
            height={13}
            className="text-text-secondary mt-[3px] flex-none opacity-60"
          />
        ) : null}
      </div>
      <div className="tt-numeric mt-3 text-[32px] font-extrabold leading-none tracking-[-0.04em]">
        {value}
      </div>
      {delta ? (
        <div className={`tt-numeric text-caption mt-1.5 font-semibold ${deltaTone}`}>
          {delta.text}
        </div>
      ) : null}
      {bar ? (
        <div className="mt-auto flex flex-col gap-1.5 pt-3.5">
          <div className="bg-separator h-[5px] overflow-hidden rounded-[3px]">
            <div
              className="h-full rounded-[3px]"
              style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%`, background: bar.color }}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-caption text-text-secondary tt-numeric">{bar.caption}</span>
            {bar.href ? (
              <a href={bar.href} className="text-caption ml-auto font-semibold">
                View details
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
