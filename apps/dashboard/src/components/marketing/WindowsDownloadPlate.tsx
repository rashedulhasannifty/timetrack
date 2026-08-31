import Link from 'next/link';
import { SpecPlate } from './MarketingChrome';

/**
 * The Windows client is published to its OWN GitHub repository, separate from the macOS one.
 *
 * That separation is not organisational tidiness — it is what keeps the Mac client working.
 * GitHub exposes a single `releases/latest` per repository, and both the shipped macOS client's
 * update feed and `MacDownloadPlate.DOWNLOAD_URL` resolve through it, requiring an asset named
 * `NiftyTimer-pilot.zip`. A Windows release published alongside would become `latest`: every
 * installed Mac client would go silently blind to updates and this page's Mac download would
 * start answering 404. A Mac client already on someone's laptop cannot be rolled back to fix it.
 *
 * So: do not point these constants at the macOS repository, and do not "consolidate" the two.
 */
export const DOWNLOAD_URL =
  'https://github.com/rashedulhasansojib/niftytimer-windows/releases/latest/download/NiftyTimer-windows-pilot.zip';

export const RELEASES_URL = 'https://github.com/rashedulhasansojib/niftytimer-windows/releases';

export function WindowsDownloadPlate() {
  return (
    <>
      <p className="text-text-secondary mb-6">
        Read the install guide first: this build is not yet code-signed, so Windows shows a
        SmartScreen warning the first time you run it and needs one extra confirmation.
      </p>

      <div className="border-manual/40 bg-manual/10 mb-6 rounded-lg border p-4">
        <p className="text-caption text-text-secondary font-mono tracking-[0.1em] uppercase">
          This build is for our own pilot
        </p>
        <p className="mt-2">
          The server address is compiled into the app, pointing at this deployment, and cannot be
          changed after the fact. It is published openly so testers can install it without a login —
          but it is only useful with an account we issued. Running Nifty Timer for your own
          organization needs a build pointed at <em>your</em> server.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <a
          href={DOWNLOAD_URL}
          className="bg-accent hover:bg-accent-hover rounded-md px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors"
        >
          Download Nifty Timer for Windows
        </a>
        <Link
          href="/install/windows"
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
          ['Requires', 'Windows 10 version 1809 or newer, 64-bit'],
          ['Permission', 'None — Windows asks for no grant to record the screen'],
          ['Install', 'Unzip anywhere and run NiftyTimer.exe — no installer, no admin rights'],
          ['Updates', 'Checked automatically; applied only when you choose'],
        ]}
      />
    </>
  );
}
