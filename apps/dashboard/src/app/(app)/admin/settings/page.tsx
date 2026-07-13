import { PageHeader } from '../../../../components/ui/PageHeader';
import { Forbidden } from '../../../../components/ui/Forbidden';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { SettingsForm } from './SettingsForm';

/**
 * Slice 1.2 — the monitoring policy editor. ADMIN-only; reads the team's current settings and
 * edits them through TeamSettingsSchema. Server Component fetches; the client SettingsForm
 * submits to a Server Action that validates and audits the change.
 */
export default async function AdminSettingsPage() {
  const session = await getSession();
  if (!session) return null; // the layout already gated; this satisfies type-narrowing.
  if (session.role !== 'ADMIN') return <Forbidden />;

  const team = await api.getCurrentTeam(session.accessToken);

  return (
    <>
      <PageHeader
        title="Monitoring policy"
        subtitle="Screenshot interval, blur, retention, idle threshold (PRD §6.6). Every change is audited."
      />
      <SettingsForm settings={team.settings} />
    </>
  );
}
