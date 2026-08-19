import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DOWNLOAD_URL } from '../../components/marketing/MacDownloadPlate';
import { RecordsTable } from '../../components/marketing/RecordsTable';
import { CopyCommand } from '../../components/marketing/CopyCommand';
import {
  MarketingChrome,
  Section,
  SpecPlate,
  Prose,
} from '../../components/marketing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Install Nifty Timer for Mac',
  description:
    'Step-by-step install guide for the Nifty Timer macOS client, including what it records and how to clear the first-launch prompt.',
};

/**
 * Public — no session required. Testers reach this before they have an account, and it is
 * linked from the release notes, so it must render for a signed-out visitor.
 */

function Step({
  n,
  title,
  flagged = false,
  children,
}: {
  n: number;
  title: string;
  flagged?: boolean;
  children: ReactNode;
}) {
  const dot = flagged
    ? 'border-manual text-manual bg-manual/10'
    : 'border-separator text-text-secondary bg-surface-raised';
  return (
    <li className="border-separator relative ml-3.5 border-l pb-8 pl-11 last:border-transparent last:pb-0">
      <span
        className={`text-caption absolute -left-3.5 top-0 flex h-7 w-7 items-center justify-center rounded-full border font-mono tabular-nums ${dot}`}
        aria-hidden="true"
      >
        {n}
      </span>
      <h3 className="mb-1.5 text-[1.0625rem] leading-snug font-semibold">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </li>
  );
}

function Aside({ children }: { children: ReactNode }) {
  return <p className="text-text-secondary text-label">{children}</p>;
}

export default function InstallPage() {
  return (
    <MarketingChrome>
      <header className="grid items-start gap-x-16 gap-y-10 py-16 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-24">
        <div className="flex flex-col gap-5">
          <p className="text-caption text-accent font-mono tracking-[0.14em] uppercase">
            Install guide · macOS
          </p>
          <h1 className="text-h1 font-display font-semibold tracking-[-0.025em] text-balance">
            Installing Nifty Timer
          </h1>
          <p className="text-text-secondary max-w-[58ch] text-[1.0625rem] leading-relaxed text-pretty">
            Download it, grant one permission, and you’re done. About five minutes, most of it
            waiting for macOS.
          </p>
          <div className="pt-1">
            <a
              href={DOWNLOAD_URL}
              className="bg-accent hover:bg-accent-hover inline-block rounded-full px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors"
            >
              Download Nifty Timer for Mac
            </a>
          </div>
        </div>
        <SpecPlate
          rows={[
            ['Works on', 'macOS 14 Sonoma or newer, Apple Silicon'],
            ['Signed by', 'Nifty IT Solution — verified before publishing'],
            ['Apple check', 'Not notarized yet — this is why step 4 exists'],
            ['Permission', 'Screen Recording, and nothing else'],
          ]}
        />
      </header>

      <Section eyebrow="Read this first" title="What the app records">
        <Prose>
          <p className="text-text-secondary mb-7">
            This is monitoring software and you should know what it does before installing it. The
            app shows you this list again on first launch, generated from the settings your
            organization actually has switched on — trust that screen over this page.
          </p>
        </Prose>
        <RecordsTable />
        <Prose>
          <p className="border-separator text-text-secondary mt-5 border-l-2 pl-4">
            The activity percentage is counted, not read: the app asks macOS how many key and mouse
            events happened, never which ones. Nothing is captured until you sign in <em>and</em>{' '}
            tick the acknowledgement. The menu bar icon is always visible and cannot be switched off
            — not by you, not by an administrator. You can view everything recorded about you in the
            dashboard, and redact any screenshot.
          </p>
        </Prose>
      </Section>

      <Section eyebrow="Install" title="Six steps, in order">
        <Prose>
          <p className="text-text-secondary mb-7">
            Step 2 is the one people skip, and skipping it is what triggers step 4.
          </p>
        </Prose>

        <ol className="flex max-w-[64ch] flex-col">
          <Step n={1} title="Unzip the download — but don’t open the app yet">
            <p>
              Double-click <strong>NiftyTimer-pilot.zip</strong> in your Downloads folder. You’ll
              get <strong>Nifty Timer.app</strong>. Leave it where it is for now.
            </p>
          </Step>

          <Step n={2} title="Clear the download flag">
            <p>
              macOS tags anything that arrives from a browser, Slack, or email. Open{' '}
              <strong>Terminal</strong> (⌘ Space, type “Terminal”) and paste this:
            </p>
            <CopyCommand command={'xattr -dr com.apple.quarantine ~/Downloads/"Nifty Timer.app"'} />
            <Aside>
              Nothing will print — that means it worked. If you unzipped somewhere other than
              Downloads, type the command then drag the app onto the Terminal window to fill in the
              path.
            </Aside>
          </Step>

          <Step n={3} title="Move it to Applications and open it">
            <p>
              Drag <strong>Nifty Timer.app</strong> into your <strong>Applications</strong> folder,
              then double-click it.
            </p>
            <Aside>
              A small clock icon appears in the menu bar at the top right. There’s no window in the
              Dock — that’s normal, it lives entirely in the menu bar.
            </Aside>
          </Step>

          <Step n={4} flagged title="Only if macOS refuses to open it">
            <p>
              If you see{' '}
              <em>“Nifty Timer cannot be opened because the developer cannot be verified”</em>, the
              flag from step 2 was still set. Nothing is wrong with the app.
            </p>
            <p>
              Open <strong>System Settings → Privacy &amp; Security</strong>, scroll down to{' '}
              <strong>Security</strong>, and click <strong>Open Anyway</strong> next to Nifty Timer.
              Then launch it again.
            </p>
            <div className="border-manual/40 bg-manual/10 rounded-lg border p-4">
              <p className="text-caption text-text-secondary font-mono tracking-[0.1em] uppercase">
                Why this happens
              </p>
              <p className="mt-2">
                Apple’s notarization step isn’t complete for this build yet. It’s administrative
                paperwork we finish before the general release — it is not a virus warning. On macOS
                15 and later, right-clicking and choosing Open no longer works as a shortcut; you
                have to use System Settings.
              </p>
            </div>
          </Step>

          <Step n={5} title="Sign in and read the acknowledgement">
            <p>
              Use the account details you were sent. You’ll then get a screen headed{' '}
              <em>“Here’s what Nifty Timer records”</em>. Read it — it’s the authoritative version
              of the list above, built from your organization’s live settings.
            </p>
            <p>
              Tick the box to continue. <strong>Nothing at all is captured until you do</strong>,
              and there is no way for an administrator to skip this on your behalf.
            </p>
          </Step>

          <Step n={6} title="Allow Screen Recording">
            <p>
              macOS will ask for <strong>Screen Recording</strong> permission. Approve it, or switch
              Nifty Timer on under{' '}
              <strong>System Settings → Privacy &amp; Security → Screen Recording</strong>.
            </p>
            <p>
              macOS will then ask you to <strong>Quit &amp; Reopen</strong> the app. Do that — the
              permission doesn’t take effect until you do.
            </p>
            <Aside>
              This is the only permission Nifty Timer asks for. It does not use Accessibility or
              Input Monitoring, which is why it cannot see what you type even in principle. Until
              you grant it, the menu bar icon shows a visible warning and your time still tracks —
              you just won’t get screenshots.
            </Aside>
          </Step>
        </ol>
      </Section>

      <Section eyebrow="Troubleshooting" title="If something goes wrong">
        <div className="flex max-w-[64ch] flex-col">
          <Trouble summary="“The developer cannot be verified”">
            <p>
              Expected on this build — go to step 4 above. It’s a one-time confirmation per Mac, not
              something you’ll see on every launch.
            </p>
          </Trouble>

          <Trouble summary="No icon appeared in the menu bar">
            <p>
              Usually the menu bar is simply full — macOS hides overflow items, and apps with many
              menu bar icons push new ones off the edge. Try quitting an app or two, or hold ⌘ and
              drag other icons along the bar to make space.
            </p>
            <p>
              To confirm it’s actually running, paste this into Terminal. If you get a line back,
              it’s running and the icon is just hidden:
            </p>
            <CopyCommand command={'pgrep -lf "Nifty Timer"'} />
          </Trouble>

          <Trouble summary="Screenshots aren’t being taken">
            <p>
              Three things have to be true: Screen Recording is granted, you restarted the app after
              granting it, and your clock is actually running. Screenshots are deliberately tied to
              tracking — a stopped clock captures nothing.
            </p>
            <p>
              If Screen Recording looks enabled but nothing happens, switch Nifty Timer off and back
              on under System Settings → Privacy &amp; Security → Screen Recording, then quit and
              reopen the app.
            </p>
          </Trouble>

          <Trouble summary="It won’t connect, or sign-in fails">
            <p>
              The app talks to this deployment, compiled in at build time — it cannot be pointed
              elsewhere, and it only works with an account we issued. If you’re on a VPN or a
              restricted network, try switching networks before reporting it.
            </p>
            <p>
              Your tracked time isn’t lost while offline — the app holds entries locally and uploads
              them when the connection returns.
            </p>
          </Trouble>

          <Trouble summary="I want to remove it">
            <p>
              Quit Nifty Timer from the menu bar, then drag the app from Applications to the Trash.
              Also switch it off under System Settings → Privacy &amp; Security → Screen Recording
              so no stale entry is left behind.
            </p>
          </Trouble>
        </div>
      </Section>
    </MarketingChrome>
  );
}

function Trouble({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="border-separator border-b py-4 first:border-t">
      <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
        <span className="text-text-secondary mr-3 font-mono">+</span>
        {summary}
      </summary>
      <div className="text-text-secondary text-label mt-2.5 flex flex-col gap-2.5 pl-6">
        {children}
      </div>
    </details>
  );
}
