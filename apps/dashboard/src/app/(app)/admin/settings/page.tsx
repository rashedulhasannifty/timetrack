import { PageHeader } from '../../../../components/ui/PageHeader';

export default function AdminSettingsPage() {
  return (
    <>
      <PageHeader
        title="Monitoring policy"
        subtitle="Screenshot interval, blur, retention, idle threshold (PRD §6.6)."
      />
      <p className="text-sm text-neutral-500">
        Scaffold. Admin only. Edits are validated through <code>TeamSettingsSchema</code> and audited.
      </p>
    </>
  );
}
