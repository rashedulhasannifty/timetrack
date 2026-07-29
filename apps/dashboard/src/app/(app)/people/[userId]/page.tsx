import Link from 'next/link';
import { Avatar } from '../../../../components/ui/Avatar';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { PersonDayView } from '../../../../components/day/PersonDayView';
import { getSession } from '../../../../lib/session';
import { api } from '../../../../lib/api-client';
import { personDayView, resolveDayDate } from '../../../../lib/person-day-view';
import { ScreenshotsPanel } from '../../me/ScreenshotsPanel';
import { toScreenshotView } from '../../me/screenshot-view';
import type { ActivitySample, Screenshot, TimeEntry } from '@timetrack/contracts';

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
  const [samples, screenshots] = await Promise.all([
    api.listActivitySamples(session.accessToken, search).catch((): ActivitySample[] => []),
    api.listScreenshots(session.accessToken, search).catch((): Screenshot[] => []),
  ]);

  // Decorative header data only — never let a lookup failure crash the page.
  let person = { name: 'Team member', tracking: false };
  try {
    const ov = await api.teamOverview(session.accessToken);
    const row = ov.rows.find((r) => r.userId === userId);
    if (row) person = { name: row.name, tracking: row.tracking };
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
        });

  return (
    <>
      <SetPageTitle title={entries === null ? 'Person' : person.name} />
      {model === null ? (
        <p className="text-text-secondary text-body">You’re not permitted to view this person.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/"
              className="border-separator text-text-secondary rounded-md border px-2.5 py-1.5 text-label"
            >
              ← Back
            </Link>
            <Avatar name={person.name} size={40} />
            <div>
              <div className="text-[22px] font-semibold tracking-[-0.02em]">{person.name}</div>
              {person.tracking ? (
                <div className="text-caption text-text-secondary flex items-center gap-1.5">
                  <span className="bg-recording h-[7px] w-[7px] rounded-full" />
                  Currently tracking
                </div>
              ) : null}
            </div>
          </div>

          <PersonDayView
            model={model}
            screenshots={<ScreenshotsPanel shots={screenshots.map(toScreenshotView)} />}
          />
        </div>
      )}
    </>
  );
}
