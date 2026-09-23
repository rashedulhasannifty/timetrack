import Link from 'next/link';
import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../lib/redirect';
import { buttonClasses } from '../../../../components/ui/Button';
import { SetPageTitle } from '../../../../components/ui/PageTitleContext';
import { getSession } from '../../../../lib/session';
import { loadPersonDay, PersonDayContent } from '../../../../components/people/PersonDayContent';

// Next 16 — route params are async.
export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string; panel?: string }>;
}) {
  const { userId } = await params;
  const session = await getSession();
  // NOT `return null`: the (app) layout's redirect does NOT re-run on a client-side
  // navigation — Next reuses the cached layout segment and re-renders only this page. Once
  // the 15-minute access token expired, every soft nav therefore rendered the shell with an
  // empty <main> (the header still looked right because TopBar derives it from the pathname),
  // and only a manual refresh — which re-runs the layout — recovered. Every page that reads
  // the session has to be able to gate on its own.
  if (!session) redirect(refreshBackTo(`/people/${userId}`));

  const { date: rawDate, panel: rawPanel } = await searchParams;
  // Shared with the Overview drawer that intercepts this URL — see PersonDayContent.
  const day = await loadPersonDay({ token: session.accessToken, userId, rawDate, rawPanel });

  return (
    <>
      <SetPageTitle title={day.title} />
      <PersonDayContent
        day={day}
        lead={
          <div>
            <Link href="/overview" className={buttonClasses('secondary', 'sm')}>
              ← Back
            </Link>
          </div>
        }
      />
    </>
  );
}
