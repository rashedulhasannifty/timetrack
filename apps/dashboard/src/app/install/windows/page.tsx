import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DOWNLOAD_URL } from '../../../components/marketing/WindowsDownloadPlate';
import { RecordsTable } from '../../../components/marketing/RecordsTable';
import {
  MarketingChrome,
  Section,
  SpecPlate,
  Prose,
} from '../../../components/marketing/MarketingChrome';

export const metadata: Metadata = {
  title: 'Install Nifty Timer for Windows',
  description:
    'Step-by-step install guide for the Nifty Timer Windows client, including what it records and how to clear the SmartScreen warning.',
};

/**
 * Public — no session required. Testers reach this before they have an account, and it is linked
 * from the release notes, so it must render for a signed-out visitor.
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

export default function InstallWindowsPage() {
  return (
    <MarketingChrome>
      <header className="grid items-start gap-x-16 gap-y-10 py-16 lg:grid-cols-[minmax(0,1fr)_24rem] lg:py-24">
        <div className="flex flex-col gap-5">
          <p className="text-caption text-accent font-mono tracking-[0.14em] uppercase">
            Install guide · Windows
          </p>
          <h1 className="text-h1 font-display font-semibold tracking-[-0.025em] text-balance">
            Installing Nifty Timer
          </h1>
          <p className="text-text-secondary max-w-[58ch] text-[1.0625rem] leading-relaxed text-pretty">
            Unzip it, click past one Windows warning, and sign in. Two minutes — there is no
            installer and nothing to grant.
          </p>
          <div className="pt-1">
            <a
              href={DOWNLOAD_URL}
              className="bg-accent hover:bg-accent-hover inline-block rounded-full px-5 py-2.5 text-[0.9375rem] font-semibold text-white transition-colors"
            >
              Download Nifty Timer for Windows
            </a>
          </div>
        </div>
        <SpecPlate
          rows={[
            ['Works on', 'Windows 10 version 1809 or newer, 64-bit'],
            ['Signed by', 'Nobody yet — this is why step 2 exists'],
            ['Permission', 'None. Windows asks for no grant to record the screen'],
            ['Admin rights', 'Not needed — it installs into your own user folder'],
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
            The activity percentage is counted, not read. The app asks Windows only for the{' '}
            <em>header</em> of each input event — which device it came from — and never retrieves
            the part that says which key was pressed. Nothing is captured until you sign in{' '}
            <em>and</em> tick the acknowledgement. The tray icon is always visible and cannot be
            switched off, not by you and not by an administrator. You can view everything recorded
            about you in the dashboard, and redact any screenshot.
          </p>
        </Prose>
      </Section>

      <Section eyebrow="Install" title="Four steps, in order">
        <Prose>
          <p className="text-text-secondary mb-7">
            Step 2 is the one that looks alarming. It is expected, and the reason is explained
            below.
          </p>
        </Prose>

        <ol className="flex max-w-[64ch] flex-col">
          <Step n={1} title="Unzip it somewhere permanent">
            <p>
              Right-click <strong>NiftyTimer-windows-pilot.zip</strong> in your Downloads folder and
              choose <strong>Extract All…</strong>. Put the folder somewhere it can stay — your user
              folder is ideal. <strong>Do not run it from inside the zip:</strong> Windows unpacks
              that to a temporary folder that gets cleared, and the app would lose its settings and
              any work it had not yet uploaded.
            </p>
            <Aside>
              Updates replace this folder in place, so moving it later is fine — just move the whole
              folder, not the .exe on its own.
            </Aside>
          </Step>

          <Step n={2} title="Click past the SmartScreen warning" flagged>
            <p>
              Run <strong>NiftyTimer.exe</strong>. Windows shows a blue box saying{' '}
              <strong>“Windows protected your PC.”</strong> Click <strong>More info</strong>, then{' '}
              <strong>Run anyway</strong>.
            </p>
            <Aside>
              This appears because the build is not yet code-signed, not because anything is wrong
              with it. SmartScreen warns about any application it has not seen enough copies of
              before — a certificate is what buys reputation, and this pilot does not have one yet.
              You should see this warning exactly once. If you see it on a later launch, the app was
              replaced; check with us before clicking through.
            </Aside>
          </Step>

          <Step n={3} title="Sign in and read the acknowledgement">
            <p>
              A window asks for the email and password we issued you. After signing in you are shown
              exactly what your organization has switched on, and you have to tick to acknowledge
              it. <strong>Nothing is recorded until you do</strong> — not screenshots, not activity,
              not app names. That gate is not skippable, and there is no administrator override.
            </p>
          </Step>

          <Step n={4} title="Find it in the system tray">
            <p>
              Nifty Timer lives in the tray, next to the clock. Windows often hides new tray icons
              behind the <strong>^</strong> arrow — click it, then drag Nifty Timer down onto the
              taskbar so it is always visible.
            </p>
            <Aside>
              Worth doing. The icon is how you can tell at a glance whether the clock is running,
              and it is the only control you need day to day. Nothing in the app can hide it.
            </Aside>
          </Step>
        </ol>
      </Section>

      <Section eyebrow="Worth knowing" title="Where Windows differs from the Mac build">
        <Prose>
          <p className="text-text-secondary mb-7">
            Both clients record the same things and feed the same dashboard. Three differences are
            worth knowing before you compare notes with a colleague on a Mac.
          </p>
        </Prose>
        <SpecPlate
          rows={[
            [
              'Websites',
              'Not categorized on Windows. There is no reliable way to read the active browser tab, so time in a browser is categorized by the browser itself, not by the site.',
            ],
            [
              'Protected video',
              'Screenshots of DRM-protected video — a streaming service — come out black rather than showing the content.',
            ],
            [
              'Permissions',
              'None to grant. macOS requires a Screen Recording permission; Windows requires nothing, so there is no prompt and nothing to re-approve.',
            ],
          ]}
        />
      </Section>

      <Section eyebrow="If something goes wrong" title="Troubleshooting">
        <Prose>
          <p className="mb-2 font-medium">The tray icon is not there</p>
          <p className="text-text-secondary mb-6">
            Check the hidden-icons arrow (<strong>^</strong>) first — that is where Windows puts new
            tray icons. If it is genuinely absent, open Task Manager and look for{' '}
            <strong>NiftyTimer.exe</strong> under Details. If the process is running but has no
            icon, restart the app; if Windows Explorer restarted, the icon comes back on its own.
          </p>

          <p className="mb-2 font-medium">The clock will not start</p>
          <p className="text-text-secondary mb-6">
            The most common cause is that you are already tracking on another machine. The server
            allows one running entry per person, so the app says so and leaves the clock stopped.
            Stop the timer on the other machine first.
          </p>

          <p className="mb-2 font-medium">Antivirus flagged it</p>
          <p className="text-text-secondary mb-6">
            An unsigned application that watches for keyboard and mouse activity is a shape that
            some corporate security tools flag on sight. The app counts input events without ever
            retrieving what was typed — it does not install a keyboard hook — but that distinction
            is not one a scanner makes. Tell us rather than adding an exclusion yourself.
          </p>

          <p className="mb-2 font-medium">Time is missing from the dashboard</p>
          <p className="text-text-secondary">
            The app keeps everything on disk until the server confirms it, so an outage delays
            uploads rather than losing them. Open the tray menu — it shows how many records are
            still waiting. If that number is stuck for more than a few minutes while you are online,
            tell us.
          </p>
        </Prose>
      </Section>
    </MarketingChrome>
  );
}
