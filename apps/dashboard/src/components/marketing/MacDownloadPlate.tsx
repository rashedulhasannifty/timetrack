import Link from 'next/link';
import { SpecPlate } from './MarketingChrome';

/**
 * The macOS client is distributed as a GitHub release asset rather than served from this
 * host — the release page is the one place the build, its notes, and its checksum live
 * together. `releases/latest/download/<asset>` always resolves to the newest release, so
 * this link never needs updating; keep the asset filename stable when publishing.
 */
export const DOWNLOAD_URL =
  'https://github.com/rashedulhasansojib/timetrack-app/releases/latest/download/TimeTrack-pilot.zip';

export const RELEASES_URL = 'https://github.com/rashedulhasansojib/timetrack-app/releases';

export function MacDownloadPlate() {
  return (
    <>
      <p className="text-text-secondary mb-6">
        Signed by Nifty IT Solution and verified before publishing. Read the install guide first:
        because this build is not yet notarized, macOS asks for one extra confirmation the first
        time you open it.
      </p>

      <div className="border-manual/40 bg-manual/10 mb-6 rounded-lg border p-4">
        <p className="text-caption text-text-secondary font-mono tracking-[0.1em] uppercase">
          This build is for our own pilot
        </p>
        <p className="mt-2">
          The server address is compiled into the app, pointing at this deployment, and cannot be
          changed after the fact. It is published openly so testers can install it without a login —
          but it is only useful with an account we issued. Running TimeTrack for your own
          organization needs a build pointed at <em>your</em> server.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <a
          href={DOWNLOAD_URL}
          className="bg-accent hover:bg-accent-hover rounded-md px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors"
        >
          Download TimeTrack for Mac
        </a>
        <Link
          href="/install"
          className="border-separator bg-surface-raised hover:border-text-secondary rounded-md border px-5 py-2.5 text-[0.9375rem] font-medium transition-colors"
        >
          Read the install guide
        </Link>
        <a
          href={RELEASES_URL}
          className="border-separator bg-surface-raised hover:border-text-secondary rounded-md border px-5 py-2.5 text-[0.9375rem] font-medium transition-colors"
        >
          All releases
        </a>
      </div>

      <SpecPlate
        rows={[
          ['Requires', 'macOS 14 Sonoma or newer, Apple Silicon'],
          ['Permission', 'Screen Recording only — no Accessibility, no Input Monitoring'],
          ['Apple check', 'Signed, not yet notarized — one confirmation on first launch'],
          ['Server', 'Compiled in at build time to this deployment'],
        ]}
      />
    </>
  );
}
