import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { SettingsForm } from './SettingsForm';
import type { TeamSettings } from '@timetrack/contracts';

const BLUR_LABEL: Record<TeamSettings['screenshotBlur'], string> = {
  NONE: 'No blur',
  BLUR: 'Blur',
  THUMBNAIL_ONLY: 'Thumbnail only',
};

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-separator flex items-baseline gap-3 border-b pb-2.5 text-[13px]">
      <span className="text-text-secondary flex-1">{label}</span>
      <span className="tt-numeric">{value}</span>
    </div>
  );
}

/**
 * Slice 1.2 — the monitoring policy editor. ADMIN-only; reads the team's current settings and
 * edits them through TeamSettingsSchema. Server Component fetches; the client SettingsForm
 * submits to a Server Action that validates and audits the change. The "Effective policy" card
 * is a read-only mirror of the saved settings — no new data, derived from team.settings.
 */
export default async function AdminSettingsPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  if (session.role !== 'ADMIN') return <Forbidden />;

  // The observed-apps list only powers a convenience picker, so a failure must not break the
  // settings page — fall back to no suggestions.
  const [team, observed] = await Promise.all([
    api.getCurrentTeam(session.accessToken),
    api.getObservedApps(session.accessToken).catch(() => ({ appNames: [] as string[] })),
  ]);
  const { settings } = team;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <SettingsForm settings={settings} observedApps={observed.appNames} />
        <Card padding="md" className="flex flex-col gap-3">
          <div className="text-text text-[15px] font-semibold">Effective policy</div>
          <div className="flex flex-col gap-2.5">
            <PolicyRow
              label="Screenshot interval"
              value={`${settings.screenshotIntervalMinutes} min`}
            />
            <PolicyRow label="Blur" value={BLUR_LABEL[settings.screenshotBlur]} />
            <PolicyRow
              label="Screenshot retention"
              value={`${settings.screenshotRetentionDays} days`}
            />
            <PolicyRow label="Idle threshold" value={`${settings.idleThresholdMinutes} min`} />
            <PolicyRow
              label="Distraction re-nudge"
              value={`${settings.distractionRepeatMinutes} min`}
            />
          </div>
          <p className="text-text-secondary text-caption">
            Changes take effect on each client’s next heartbeat (≤60s).
          </p>
        </Card>
      </div>
    </>
  );
}
