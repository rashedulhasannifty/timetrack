import Link from 'next/link';
import { Avatar } from '../../../../components/ui/Avatar';
import { buttonClasses } from '../../../../components/ui/Button';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { PersonDayView } from '../../../../components/day/PersonDayView';
import { DayAppUsage } from '../../../../components/day/DayAppUsage';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { personDayView, resolveDayDate } from '../../../../lib/person-day-view';
import { ScreenshotsPanel } from '../../me/ScreenshotsPanel';
import { toScreenshotView } from '../../me/screenshot-view';
import type {
  ActivitySample,
  Project,
  Screenshot,
  TeamAppUsage,
  TimeEntry,
} from '@timetrack/contracts';

// Next 16 — route params are async.
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { userId } = await params;
  const session = await getSession();
  if (!session) return null;

  const { date: rawDate } = await searchParams;
  const date = resolveDayDate(rawDate, new Date());

  const search = new URLSearchParams({
    userId,
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
  });

  let entries: TimeEntry[] | null = null;
  try {
    // The API enforces manager-owns-team; a 403 on this read becomes the not-authorized state.
    entries = await api.listTimeEntries(session.accessToken, search);
  } catch {
    entries = null;
  }

  // Same manager-owns-team authz applies to these reads, but a failure here shouldn't wall off
  // the whole page — it degrades the relevant panel to empty instead.
  const [samples, screenshots, projects, appUsage] = await Promise.all([
    api.listActivitySamples(session.accessToken, search).catch((): ActivitySample[] => []),
    api.listScreenshots(session.accessToken, search).catch((): Screenshot[] => []),
    // Names for the entries. Team-scoped to the caller, so this resolves for the common
    // manager-owns-team view; a cross-team admin view degrades to "Untitled entry" per entry.
    api.listProjects(session.accessToken, { includeArchived: true }).catch((): Project[] => []),
    // `search` already carries userId + the day window, which is what app-usage wants; the
    // API re-checks manager-owns-team on that userId and 403s if it doesn't hold.
    api.appUsage(session.accessToken, search).catch((): TeamAppUsage | null => null),
  ]);

  // Decorative header data only — never let a lookup failure crash the page.
  let person = { name: 'Team member' };
  try {
    const ov = await api.teamOverview(session.accessToken);
    const row = ov.rows.find((r) => r.userId === userId);
    if (row) person = { name: row.name };
  } catch {
    /* decorative — never crash the header */
  }

  const model =
    entries === null
      ? null
      : personDayView({
          date,
          now: new Date(),
          isSelf: false,
          subjectName: person.name,
          entries,
          samples,
          screenshots,
          projects,
        });

  return (
    <>
      <SetPageTitle title={entries === null ? 'Person' : person.name} />
      {model === null ? (
        <p className="text-text-secondary text-body">You’re not permitted to view this person.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <Link href="/overview" className={buttonClasses('secondary', 'sm')}>
              ← Back
            </Link>
          </div>

          <PersonDayView
            model={model}
            avatar={<Avatar name={person.name} size={40} />}
            apps={<DayAppUsage usage={appUsage} />}
            screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} />}
          />
        </div>
      )}
    </>
  );
}
