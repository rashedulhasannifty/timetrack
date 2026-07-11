import { PageHeader } from '../../../../components/ui/PageHeader';

export default function AdminAuditPage() {
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every edit, deletion, and erasure (PRD §6.6)." />
      <p className="text-sm text-neutral-500">Scaffold. Admin only.</p>
    </>
  );
}
