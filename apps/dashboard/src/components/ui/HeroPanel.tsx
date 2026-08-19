import type { ReactNode } from 'react';

/**
 * The one gradient panel on the page — the headline number the whole view exists to report.
 * Its ground is fixed dark teal in both themes (see the `hero`* tokens), so everything inside
 * it reads against `hero-text` / `hero-dim` rather than the surrounding surface's text tokens.
 *
 * Deliberately singular: a second one on the same screen and neither is the headline any more.
 */
export function HeroPanel({
  label,
  children,
  footer,
  className = '',
}: {
  label: string;
  /** The headline value. */
  children: ReactNode;
  /** Delta line, sparkline — anything that sits under the number. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`text-hero-text relative flex flex-col overflow-hidden rounded-lg px-7 py-[26px] ${className}`.trim()}
      style={{
        background: 'linear-gradient(145deg, var(--tt-hero) 0%, var(--tt-hero-2) 100%)',
      }}
    >
      <span className="text-hero-dim text-label font-semibold">{label}</span>
      {children}
      {footer}
    </section>
  );
}

/** The pill that carries a delta inside the hero panel. */
export function HeroDelta({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <span className="tt-numeric text-label mt-2.5 inline-flex items-center gap-[7px] font-semibold">
      <span className="inline-flex items-center rounded-full bg-white/15 px-[9px] py-0.5">
        {children}
      </span>
      {note ? <span className="text-hero-dim">{note}</span> : null}
    </span>
  );
}
