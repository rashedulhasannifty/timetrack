import type { ReactNode } from 'react';
import Link from 'next/link';
import { getSession } from '../../lib/session';
import { ThemeToggle } from '../ui/ThemeToggle';
import { BrandMark } from '../ui/BrandMark';

/**
 * Layout primitives for the two public pages (/ and /install). These render without a
 * session, so they deliberately share nothing with AppShell — no sidebar, no user chrome,
 * no calls that would need a token. Styling comes from the same design tokens as the app
 * (globals.css) so the marketing pages and the product read as one thing.
 *
 * Two widths: the home page runs `wide` and uses the space for a label rail beside each
 * section; /install runs `reading`, because a guide someone follows step by step wants a
 * single comfortable measure, not a second column to track.
 *
 * The nav reads the session purely to pick its last link: a signed-in visitor gets "Open
 * dashboard" instead of "Sign in", which is the only route back to the app once the
 * sidebar's "Install the Mac app" has dropped them out here. Reading the cookie makes both
 * public pages dynamic — acceptable for a self-hosted dashboard, and the pages hold no
 * per-user data beyond that one label. An expired access token reads as signed-out and
 * shows "Sign in"; that lands on /login, which is a correct, if slightly long, way home.
 */

export async function MarketingChrome({
  children,
  width = 'wide',
}: {
  children: ReactNode;
  width?: 'wide' | 'reading';
}) {
  const signedIn = (await getSession()) !== null;
  const shell = width === 'wide' ? 'max-w-[76rem]' : 'max-w-[48rem]';
  return (
    <div className={`mx-auto w-full px-6 pb-28 sm:px-8 ${shell}`}>
      <nav className="border-separator sticky top-0 z-10 flex items-center justify-between gap-4 border-b py-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-mono text-[0.9375rem] font-medium tracking-[-0.02em]"
        >
          <BrandMark />
          Nifty Timer
        </Link>
        <div className="text-label text-text-secondary flex items-center gap-5">
          <Link href="/install" className="hover:text-text transition-colors">
            Install
          </Link>
          {signedIn ? (
            <Link href="/overview" className="hover:text-text transition-colors">
              Open dashboard
            </Link>
          ) : (
            <Link href="/login" className="hover:text-text transition-colors">
              Sign in
            </Link>
          )}
          <ThemeToggle />
        </div>
      </nav>
      {children}
      <footer className="border-separator text-label text-text-secondary mt-6 border-t pt-8">
        <p>
          <span className="text-text font-medium">Nifty Timer</span> — built and run by Nifty IT
          Solution, Dhaka.
        </p>
      </footer>
    </div>
  );
}

/**
 * A section with its title in a left rail. The rail is what earns the wider shell: at
 * desktop widths the label sits beside the content instead of stacking above it, so the
 * page reads as a specification rather than a scroll of stacked blocks.
 */
export function Section({
  eyebrow,
  title,
  children,
  layout = 'rail',
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** `rail` puts the title beside the content — only use inside the wide shell. */
  layout?: 'rail' | 'stacked';
}) {
  const rail = layout === 'rail';
  return (
    <section
      className={`border-separator grid gap-x-16 gap-y-6 border-t py-16 ${
        rail ? 'lg:grid-cols-[15rem_minmax(0,1fr)]' : ''
      }`}
    >
      <div className={rail ? 'lg:sticky lg:top-24 lg:self-start' : ''}>
        <p className="text-caption text-accent mb-2 font-mono tracking-[0.14em] uppercase">
          {eyebrow}
        </p>
        <h2 className="text-h2 font-display font-semibold tracking-[-0.02em] text-balance">
          {title}
        </h2>
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Constrains running text to a readable measure inside the wide shell. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-[64ch]">{children}</div>;
}

/** A labelled row — the spec-sheet motif used for grouped prose. */
export function KeyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-separator grid gap-2 border-b py-5 first:border-t sm:grid-cols-[11rem_1fr] sm:gap-8">
      <div className="text-caption text-text-secondary pt-1 font-mono tracking-[0.09em] uppercase">
        {label}
      </div>
      <div className="max-w-[62ch]">{children}</div>
    </div>
  );
}

/** Key/value plate. Rows are [label, value]; the last row drops its rule. */
export function SpecPlate({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="border-separator bg-surface-raised grid grid-cols-1 overflow-hidden rounded-lg border sm:grid-cols-[11rem_1fr]">
      {rows.map(([k, v], i) => {
        const rule = i === rows.length - 1 ? '' : 'border-b';
        return (
          <div key={k} className="contents">
            <dt
              className={`border-separator bg-surface text-caption text-text-secondary px-4 py-3 font-mono tracking-[0.08em] uppercase ${rule}`}
            >
              {k}
            </dt>
            <dd className={`border-separator text-label px-4 py-3 ${rule}`}>{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}
