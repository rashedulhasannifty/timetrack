import { Forbidden } from '../../../../components/ui/Forbidden';
import { Card } from '../../../../components/ui/Card';
import { AdminTabs } from '../../../../components/ui/AdminTabs';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { SettingsForm } from './SettingsForm';
import { TeamPolicyPicker } from './TeamPolicyPicker';
import type { TeamSettings, ObservedApp } from '@timetrack/contracts';

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
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ teamId?: string }>;
}) {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  if (session.role !== 'ADMIN') return <Forbidden />;

  // The observed-apps list only powers a convenience picker, so a failure must not break the
  // settings page — fall back to no suggestions.
  const [current, teams, observed] = await Promise.all([
    api.getCurrentTeam(session.accessToken),
    api.listTeams(session.accessToken),
    api.getObservedApps(session.accessToken).catch(() => ({ apps: [] as ObservedApp[] })),
  ]);

  // ?teamId picks the team; the admin's own is the default, so the page opens on the policy
  // they are most likely to want and an existing /admin/settings bookmark is unchanged. An id
  // that no longer exists falls back rather than 404ing an admin out of the settings screen.
  const { teamId } = await searchParams;
  const team = teams.find((t) => t.id === teamId) ?? current;
  const { settings } = team;

  return (
    <>
      <SetPageTitle title="Admin" />
      <AdminTabs />
      <TeamPolicyPicker teams={teams} selectedId={team.id} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {/* Keyed by team: SettingsForm holds the classification lists in useState, so without
            this a team switch would keep the previous team's lists on screen. */}
        <SettingsForm
          key={team.id}
          teamId={team.id}
          settings={settings}
          observedApps={observed.apps}
        />
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
              label="Distraction alerts"
              value={settings.distractionAlertsEnabled ? 'On' : 'Off'}
            />
            <PolicyRow
              label="Distraction threshold"
              value={`${settings.distractionThresholdMinutes} min`}
            />
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
