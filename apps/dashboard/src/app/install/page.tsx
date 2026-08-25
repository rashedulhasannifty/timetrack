import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingChrome, Section, Prose } from '../../components/marketing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Install Nifty Timer',
  description:
    'Install the Nifty Timer client for macOS or Windows — what it records, and how to clear the first-launch prompt on each platform.',
};

/**
 * A platform chooser, not a guide.
 *
 * This route is already advertised — the sidebar, the login page, the marketing footer and the
 * release notes all link to it — so it keeps working rather than redirecting. The macOS guide
 * that used to live here moved to `/install/macos` unchanged: it is macOS-specific end to end
 * (the quarantine command, Gatekeeper's "Open Anyway", `pgrep` troubleshooting) and could not
 * have been genericised in place without turning a clear guide into a branching one.
 *
 * Public — no session required. Testers reach this before they have an account.
 */
export default function InstallPage() {
  return (
    <MarketingChrome>
      <Section eyebrow="Install" title="Which machine are you setting up?">
        <Prose>
          <p>
            Nifty Timer runs as a small app that lives in your menu bar or system tray. Both
            versions talk to this same deployment and record the same things — pick the one that
            matches the machine in front of you.
          </p>
        </Prose>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <PlatformCard
            href="/install/macos"
            platform="macOS"
            requirement="macOS 14 Sonoma or newer, Apple Silicon"
            note="Signed, but not yet notarized — one extra confirmation on first open."
          />
          <PlatformCard
            href="/install/windows"
            platform="Windows"
            requirement="Windows 10 version 1809 or newer, 64-bit"
            note="Not yet code-signed — SmartScreen warns once on first run."
          />
        </div>
      </Section>
    </MarketingChrome>
  );
}

function PlatformCard({
  href,
  platform,
  requirement,
  note,
}: {
  href: string;
  platform: string;
  requirement: string;
  note: string;
}) {
  return (
    <Link
      href={href}
      className="border-separator bg-surface-raised hover:border-text-secondary block rounded-lg border p-6 transition-colors"
    >
      <p className="text-[1.0625rem] font-medium">Nifty Timer for {platform}</p>
      <p className="text-text-secondary mt-2 text-[0.9375rem]">{requirement}</p>
      <p className="text-text-secondary mt-3 text-[0.875rem]">{note}</p>
      <p className="text-accent mt-4 text-[0.9375rem]">Install guide →</p>
    </Link>
  );
}
