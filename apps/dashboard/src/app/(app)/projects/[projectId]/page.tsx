import { PageHeader } from '../../../../components/ui/PageHeader';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <PageHeader title="Project" subtitle="Hours per project across the team (PRD §6.5)." />
      <p className="text-text-secondary text-body">
        Scaffold for project{' '}
        <code className="bg-surface text-text rounded px-1 py-0.5 font-mono">{projectId}</code>.
      </p>
    </>
  );
}
