import { PageHeader } from '../../components/ui/PageHeader';

export default function TeamOverviewPage() {
  return (
    <>
      <PageHeader
        title="Team overview"
        subtitle="Who is tracking now, and today's hours per person (PRD §6.5)."
      />
      <p className="text-sm text-neutral-500">
        Scaffold. Fetch the team summary server-side via <code>lib/api-client</code> and render
        per-person cards + an activity chart.
      </p>
    </>
  );
}
