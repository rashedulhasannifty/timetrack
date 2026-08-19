import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'destructive';

// Tone backgrounds are a colour-mix of the tone's own token rather than a second hand-picked
// hex, so a token retune carries the wash with it and light/dark stay in step automatically.
const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-[color-mix(in_oklab,var(--tt-neutral)_16%,transparent)] text-text-secondary',
  accent: 'bg-tint text-accent',
  good: 'bg-[color-mix(in_oklab,var(--tt-good)_12%,transparent)] text-good',
  warning:
    'bg-[color-mix(in_oklab,var(--tt-category-unproductive)_14%,transparent)] text-category-unproductive',
  destructive: 'bg-[color-mix(in_oklab,var(--tt-destructive)_12%,transparent)] text-destructive',
};

/** Status pill. */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`text-caption inline-flex items-center whitespace-nowrap rounded-full px-[11px] py-[3px] font-bold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** The small tabular count that rides beside a nav item or section title. */
export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="tt-numeric bg-tint text-accent text-micro inline-flex items-center rounded-full px-[7px] py-px font-bold">
      {children}
    </span>
  );
}
