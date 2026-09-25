import { Badge, type BadgeTone } from '../../../../components/ui/Badge';
import { formatDate } from '../../../../lib/format';
import type { InstallView, UpdateVerdict } from '../../../../lib/client-version';

const PLATFORM_LABEL = { MACOS: 'macOS', WINDOWS: 'Windows' } as const;

const VERDICT: Record<UpdateVerdict, { tone: BadgeTone; label: string } | null> = {
  current: { tone: 'good', label: 'Up to date' },
  available: { tone: 'accent', label: 'Update available' },
  overdue: { tone: 'warning', label: 'Needs update' },
  // Nothing to compare against (GitHub unreachable): show the version, claim nothing.
  unknown: null,
};

/**
 * The desktop app(s) a user last signed in from, one line per platform, with whether it is
 * behind the latest release. "Not reported" covers both "never installed" and "an app too old
 * to report its version" — the server cannot tell those apart.
 */
export function AppVersionCell({ installs }: { installs: InstallView[] }) {
  if (installs.length === 0) {
    return <span className="text-text-secondary">Not reported</span>;
  }
  return (
    <span className="flex flex-col gap-1">
      {installs.map((i) => {
        const verdict = VERDICT[i.verdict];
        const title =
          `Last seen ${formatDate(i.lastSeenAt)}` + (i.latest ? ` · latest is ${i.latest}` : '');
        return (
          <span key={i.platform} className="inline-flex items-center gap-2" title={title}>
            <span className="tt-numeric whitespace-nowrap">
              {PLATFORM_LABEL[i.platform]} {i.version}
            </span>
            {verdict ? <Badge tone={verdict.tone}>{verdict.label}</Badge> : null}
          </span>
        );
      })}
    </span>
  );
}
