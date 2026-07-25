import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'destructive';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface border-separator text-text-secondary',
  accent: 'bg-accent/12 border-transparent text-accent',
  good: 'bg-good/15 border-transparent text-good',
  warning: 'bg-manual/20 border-transparent text-category-unproductive',
  destructive: 'bg-destructive/12 border-transparent text-destructive',
};

/** Status pill (mockup: rounded-full, caption weight-600). */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`text-caption inline-flex items-center rounded-full border px-3 py-1 font-semibold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
