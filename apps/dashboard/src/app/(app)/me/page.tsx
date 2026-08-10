import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import { personDayView, resolveDayDate } from '../../../lib/person-day-view';
import { PersonDayView } from '../../../components/day/PersonDayView';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import { ApprovalsPanel } from './ApprovalsPanel';
import { selfApprovals } from '../../../lib/approvals-view';
import type {
  ActivitySample,
  Project,
  Screenshot,
  TimeEntry,
  TimesheetApproval,
} from '@timetrack/contracts';

/**
 * PRD §4.3 / §11 — the employee self-view. Same API as the manager view, scoped to self.
 * Date-aware: `?date=YYYY-MM-DD` selects the day rendered by PersonDayView; invalid/missing
 * falls back to today (UTC).
 */
export default async function MyDataPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const { date: rawDate } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());

  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  });

  // Self-scoped; each read is independent — a failure in one degrades to an empty panel.
  const [entries, samples, screenshots, approvals, projects] = await Promise.all([
    api.listTimeEntries(session.accessToken, todayParams).catch((): TimeEntry[] => []),
    api.listActivitySamples(session.accessToken, todayParams).catch((): ActivitySample[] => []),
    api.listScreenshots(session.accessToken, todayParams).catch((): Screenshot[] => []),
    // The API self-scopes only an EMPLOYEE; a MANAGER/ADMIN gets team/all rows, so we
    // filter to self below (selfApprovals) — this is the employee self-view.
    api
      .listApprovals(session.accessToken, new URLSearchParams())
      .catch((): TimesheetApproval[] | null => null),
    // Names for the entries: an entry carries a projectId/taskId, not names. includeArchived so a
    // historical entry on a since-archived project still resolves instead of falling to "Untitled".
    api.listProjects(session.accessToken, { includeArchived: true }).catch((): Project[] => []),
  ]);

  const myApprovals = selfApprovals(approvals, session.userId);

  const model = personDayView({
    date,
    now: new Date(),
    isSelf: true,
    subjectName: 'You',
    entries,
    samples,
    screenshots,
    projects,
  });

  return (
    <>
      <SetPageTitle title="My time" />
      <div className="flex flex-col gap-4">
        <ApprovalsPanel rows={myApprovals} />
        <PersonDayView
          model={model}
          screenshots={
            <ScreenshotsPanel
              shots={screenshots.map(toScreenshotView)}
              onRedact={redactScreenshotAction}
            />
          }
        />
      </div>
    </>
  );
}
