import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Layout primitives for the two public pages (/ and /install). These render without a
 * session, so they deliberately share nothing with AppShell — no sidebar, no user chrome,
 * no calls that would need a token. Styling comes from the same design tokens as the app
 * (globals.css) so the marketing pages and the product read as one thing.
 */

export function MarketingChrome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-24">
      <nav className="border-separator flex flex-wrap items-baseline justify-between gap-4 border-b py-6">
        <Link href="/" className="font-mono text-[0.9375rem] font-medium tracking-[-0.02em]">
          TimeTrack
        </Link>
        <div className="text-label text-text-secondary flex gap-5">
          <Link href="/install" className="hover:text-text transition-colors">
            Install
          </Link>
          <Link href="/login" className="hover:text-text transition-colors">
            Sign in
          </Link>
        </div>
      </nav>
      {children}
      <footer className="border-separator text-label text-text-secondary mt-4 border-t pt-7">
        <p>
          <span className="text-text font-medium">TimeTrack</span> — built and run by Nifty IT
          Solution, Dhaka.
        </p>
      </footer>
    </div>
  );
}

export function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-separator border-t py-12">
      <p className="text-caption text-accent mb-3 font-mono tracking-[0.14em] uppercase">
        {eyebrow}
      </p>
      <h2 className="text-h2 font-display mb-3 font-semibold tracking-[-0.02em] text-balance">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled row — the spec-sheet motif used for grouped prose. */
export function KeyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-separator grid gap-2 border-b py-4 first:border-t sm:grid-cols-[10rem_1fr] sm:gap-7">
      <div className="text-caption text-text-secondary pt-1 font-mono tracking-[0.09em] uppercase">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Key/value plate. Rows are [label, value]; the last row drops its rule. */
export function SpecPlate({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="border-separator bg-surface-raised grid grid-cols-1 overflow-hidden rounded-lg border sm:grid-cols-[10rem_1fr]">
      {rows.map(([k, v], i) => {
        const last = i === rows.length - 1;
        const rule = last ? '' : 'border-b';
        return (
          <div key={k} className="contents">
            <dt
              className={`border-separator bg-surface text-caption text-text-secondary px-4 py-2.5 font-mono tracking-[0.08em] uppercase ${rule}`}
            >
              {k}
            </dt>
            <dd className={`border-separator text-label px-4 py-2.5 ${rule}`}>{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}
