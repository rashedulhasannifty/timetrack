import { PageHeader } from '../../../../components/ui/PageHeader';

// Next 16 — route params are async.
export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <>
      <PageHeader title="Person" subtitle={`Timeline · app breakdown · activity % · screenshots`} />
      <p className="text-sm text-neutral-500">
        Scaffold for user <code>{userId}</code>. Manager drill-down (PRD §6.5); the API enforces
        that a manager may only read their own team.
      </p>
    </>
  );
}
