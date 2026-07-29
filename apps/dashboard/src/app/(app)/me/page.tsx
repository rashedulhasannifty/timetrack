import { SetPageTitle } from '../../../components/ui/PageTitleContext';
import { getSession } from '../../../lib/session';
import { api } from '../../../lib/api-client';
import { personDayView } from '../../../lib/person-day-view';
import { PersonDayView } from '../../../components/day/PersonDayView';
import { ScreenshotsPanel } from './ScreenshotsPanel';
import { toScreenshotView } from './screenshot-view';
import { redactScreenshotAction } from './actions';
import { ApprovalsPanel } from './ApprovalsPanel';
import { selfApprovals } from '../../../lib/approvals-view';
import type {
  ActivitySample,
  Screenshot,
  TimeEntry,
  TimesheetApproval,
} from '@timetrack/contracts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const date = rawDate && DATE_RE.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);

  const todayParams = new URLSearchParams({
    userId: session.userId,
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  });

  // Self-scoped; each read is independent — a failure in one degrades to an empty panel.
  const [entries, samples, screenshots, approvals] = await Promise.all([
    api.listTimeEntries(session.accessToken, todayParams).catch((): TimeEntry[] => []),
    api.listActivitySamples(session.accessToken, todayParams).catch((): ActivitySample[] => []),
    api.listScreenshots(session.accessToken, todayParams).catch((): Screenshot[] => []),
    // The API self-scopes only an EMPLOYEE; a MANAGER/ADMIN gets team/all rows, so we
    // filter to self below (selfApprovals) — this is the employee self-view.
    api
      .listApprovals(session.accessToken, new URLSearchParams())
      .catch((): TimesheetApproval[] | null => null),
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
