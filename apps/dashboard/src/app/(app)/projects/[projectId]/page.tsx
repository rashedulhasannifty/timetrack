import { PageHeader } from '../../../../components/ui/PageHeader';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <>
      <PageHeader title="Project" subtitle="Hours per project across the team (PRD §6.5)." />
      <p className="text-sm text-neutral-500">
        Scaffold for project <code>{projectId}</code>.
      </p>
    </>
  );
}
