import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warning' | 'destructive';

/**
 * Status pill. The tint is mixed from the tone's own token rather than a second background
 * token, so a pill stays legible in both themes off one value — the handoff builds every badge
 * the same way. Inline `style` (not an arbitrary utility) because `color-mix` still resolves
 * the var per theme, and it keeps the mix ratio readable.
 */
const TONE: Record<BadgeTone, { token: string; mix: number }> = {
  neutral: { token: '--tt-category-neutral', mix: 18 },
  accent: { token: '--tt-accent', mix: 14 },
  good: { token: '--tt-good', mix: 14 },
  warning: { token: '--tt-category-unproductive', mix: 18 },
  destructive: { token: '--tt-destructive', mix: 14 },
};

// Neutral reads as "no state yet", so it takes the dimmed text colour rather than the grey
// it is tinted with — grey-on-grey loses the label.
const TEXT: Record<BadgeTone, string> = {
  neutral: 'var(--tt-text-secondary)',
  accent: 'var(--tt-accent)',
  good: 'var(--tt-good)',
  warning: 'var(--tt-category-unproductive)',
  destructive: 'var(--tt-destructive)',
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const { token, mix } = TONE[tone];
  return (
    <span
      className="text-caption inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] font-semibold"
      style={{
        background: `color-mix(in oklab, var(${token}) ${mix}%, transparent)`,
        color: TEXT[tone],
      }}
    >
      {children}
    </span>
  );
}
