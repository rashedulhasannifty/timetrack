import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { dayOf } from '@timetrack/contracts';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { buttonClasses } from '../../../../components/ui/Button';
import {
  loadProjectDetail,
  ProjectDetailContent,
} from '../../../../components/projects/ProjectDetailContent';
import { getSession } from '../../../../lib/session';
import { formatDuration } from '../../../../lib/format';

// Next 16 — params and searchParams are async. The fetch and the body live in
// ProjectDetailContent (see there for why there is no project drawer).
export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { projectId } = await params;
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo(`/projects/${projectId}`));

  const sp = await searchParams;
  const data = await loadProjectDetail({ session, projectId, rawFrom: sp.from, rawTo: sp.to });
  const { detail, from, to } = data;

  return (
    <>
      <SetPageTitle
        title={detail?.name ?? 'Project'}
        kicker={
          detail
            ? `${formatDuration(detail.totalSeconds)} tracked · ${dayOf(new Date(from))} – ${to.slice(0, 10)}`
            : 'Project'
        }
      />
      <div className="mb-3">
        <Link href="/projects" className={buttonClasses('secondary', 'sm')}>
          ← Projects
        </Link>
      </div>

      <ProjectDetailContent data={data} />
    </>
  );
}
