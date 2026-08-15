import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '../lib/session';
import { DOWNLOAD_URL, MacDownloadPlate } from '../components/marketing/MacDownloadPlate';
import { RecordsTable } from '../components/marketing/RecordsTable';
import {
  MarketingChrome,
  Section,
  KeyRow,
  SpecPlate,
} from '../components/marketing/MarketingChrome';

export const metadata: Metadata = {
  title: 'TimeTrack — self-hosted time tracking',
  description:
    'Self-hosted time tracking and workforce analytics for teams of 10–50. The macOS client cannot run hidden and cannot read what you type.',
};

/**
 * The public front door. This is the only page on the domain that renders without a
 * session — everything else lives under (app), whose layout resolves the session and
 * redirects. Signed-in people never see this: they are sent straight to /overview, so
 * an existing "/" bookmark still lands on the dashboard.
 */
export default async function HomePage() {
  const session = await getSession();
  if (session) redirect('/overview');

  return (
    <MarketingChrome>
      <header className="flex flex-col gap-6 pt-14 pb-12">
        <p className="text-caption text-accent font-mono tracking-[0.14em] uppercase">
          Self-hosted · macOS + web
        </p>
        <h1 className="text-display font-display max-w-[14ch] font-semibold tracking-[-0.03em] text-balance">
          Time tracking your team can audit.
        </h1>
        <p className="text-text-secondary max-w-[62ch] text-[1.0625rem] leading-relaxed text-pretty">
          Time tracking and workforce analytics for teams of 10–50, running entirely on your own
          infrastructure. The macOS client cannot be hidden, cannot read what you type, and shows
          every person exactly what was recorded about them — because those are constraints in the
          code, not promises in a policy document.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/login"
            className="bg-accent hover:bg-accent-hover rounded-md px-5 py-2.5 text-[0.9375rem] font-medium text-white transition-colors"
          >
            Sign in
          </Link>
          <a
            href={DOWNLOAD_URL}
            className="border-separator bg-surface-raised hover:border-text-secondary rounded-md border px-5 py-2.5 text-[0.9375rem] font-medium transition-colors"
          >
            Download for Mac
          </a>
          <Link
            href="/install"
            className="border-separator bg-surface-raised hover:border-text-secondary rounded-md border px-5 py-2.5 text-[0.9375rem] font-medium transition-colors"
          >
            Install guide
          </Link>
        </div>
      </header>

      <Section eyebrow="What it does" title="Three surfaces, one record">
        <p className="text-text-secondary mb-7">
          A menu bar app on each Mac, a web dashboard for managers, and an admin surface for the
          people who have to answer for it.
        </p>
        <div className="flex flex-col">
          <KeyRow label="For the team">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Start, stop, and pause from the menu bar; assign entries to a project or task, with
                an optional note.
              </li>
              <li>
                Automatic tracking that pauses on sleep or lock and stops after an idle threshold.
              </li>
              <li>
                On return: <em>“You were away for X minutes — keep or discard?”</em> Discard is the
                default.
              </li>
              <li>
                Idle and distraction nudges arrive as <strong>local</strong> notifications, never
                streamed live to a manager.
              </li>
              <li>
                A self-view of every entry, screenshot, and activity sample recorded about you —
                with the ability to redact any screenshot, giving a reason.
              </li>
            </ul>
          </KeyRow>
          <KeyRow label="For managers">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Team overview: who is tracking now, hours per person today.</li>
              <li>
                Per-person timeline — entries, app breakdown, activity percentage, screenshot
                thumbnails.
              </li>
              <li>Hours per project across the team.</li>
              <li>Date-range CSV export, filterable by person, project, or team.</li>
              <li>Timesheet approvals for payroll.</li>
            </ul>
          </KeyRow>
          <KeyRow label="For admins">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Users, teams, and roles; OIDC single sign-on.</li>
              <li>
                Monitoring policy per team: screenshot interval, idle threshold, blur mode,
                retention, or capture off entirely.
              </li>
              <li>Productive and unproductive app and site lists, applied on the client.</li>
              <li>
                Data export and right-to-erasure tooling; deletions are written to an audit log in
                the same transaction.
              </li>
              <li>Retention enforced by a nightly job rather than by policy prose.</li>
            </ul>
          </KeyRow>
        </div>
      </Section>

      <Section eyebrow="What it records" title="The limits are structural">
        <p className="text-text-secondary mb-7">
          Monitoring software earns trust by being specific. This is the same list the app shows
          each employee on first launch — there, it is generated from your organization’s live
          settings rather than written by hand.
        </p>

        <RecordsTable />

        <div className="mt-8 flex flex-col">
          <KeyRow label="No stealth mode">
            <p>
              The menu bar indicator changes state as tracking and capture happen, and no setting,
              API, or administrator can hide it. There is no build target that removes it. This is a
              fixed product constraint, not a backlog item.
            </p>
          </KeyRow>
          <KeyRow label="Consent gate">
            <p>
              Nothing is captured until the signed-in person has acknowledged the monitoring policy.
              The gate is enforced on the server as well as the client, and there is no
              administrator override.
            </p>
          </KeyRow>
          <KeyRow label="Counted, not read">
            <p>
              The activity percentage comes from asking macOS <em>how many</em> keyboard and mouse
              events occurred — never which ones. The client requests no Accessibility or Input
              Monitoring permission, so it has no code path that could read input content even if
              someone added one.
            </p>
          </KeyRow>
          <KeyRow label="Symmetric access">
            <p>
              Employees read their own screenshots, samples, and entries through the same API a
              manager uses, scoped to themselves. Screenshot data is never readable by a manager in
              a way it is not readable by the person in it.
            </p>
          </KeyRow>
        </div>

        <div className="border-manual/40 bg-manual/10 mt-7 rounded-lg border p-4">
          <p className="text-caption text-text-secondary font-mono tracking-[0.1em] uppercase">
            Not legal advice
          </p>
          <p className="mt-2">
            Employee monitoring carries real disclosure obligations that vary by jurisdiction —
            several US states require written notice, GDPR applies to EU-based staff, and other
            countries differ. TimeTrack encodes a defensible default, but it is not a substitute for
            talking to legal and HR before you roll it out.
          </p>
        </div>
      </Section>

      <Section eyebrow="Self-hosting" title="Your servers, your database">
        <p className="text-text-secondary mb-7">
          There is no third-party SaaS in the data path. Screenshots and samples live in your own
          object storage, and nothing is sent anywhere you did not configure.
        </p>
        <SpecPlate
          rows={[
            ['API', 'NestJS on Fastify, Node 24 LTS'],
            [
              'Database',
              'PostgreSQL 18, via Prisma — activity and screenshot tables are monthly-partitioned',
            ],
            ['Dashboard', 'Next.js App Router, React 19'],
            ['Jobs', 'BullMQ on Redis — rollups, retention, email summaries'],
            ['Storage', 'MinIO, or any S3-compatible endpoint'],
            ['Client', 'Swift 6, SwiftUI and AppKit — macOS 14 Sonoma or newer, Apple Silicon'],
            ['Deploy', 'Docker Compose behind a Caddy TLS proxy'],
          ]}
        />
      </Section>

      <Section eyebrow="Download" title="macOS client — pilot build">
        <MacDownloadPlate />
      </Section>
    </MarketingChrome>
  );
}
