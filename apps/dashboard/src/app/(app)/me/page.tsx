import { PageHeader } from '../../../components/ui/PageHeader';

/**
 * PRD §4.3 — the employee self-view. Same API as the manager view, scoped to `self`.
 * Phase 2 does not ship until this does: monitoring you cannot inspect is what the
 * category gets sued over.
 */
export default function MyDataPage() {
  return (
    <>
      <PageHeader
        title="My data"
        subtitle="Everything recorded about you: time entries, activity, screenshots."
      />
      <p className="text-sm text-neutral-500">
        Scaffold. Renders the signed-in user&apos;s own timeline, activity %, and screenshot log.
      </p>
    </>
  );
}
