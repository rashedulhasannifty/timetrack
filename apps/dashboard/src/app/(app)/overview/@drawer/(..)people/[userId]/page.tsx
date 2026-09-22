import { redirect } from 'next/navigation';
import { refreshBackTo } from '../../../../../../lib/redirect';
import { getSession } from '../../../../../../lib/session';
import { RouteDrawer } from '../../../../../../components/ui/RouteDrawer';
import {
  loadPersonDay,
  PersonDayContent,
} from '../../../../../../components/people/PersonDayContent';

/**
 * The person day view, intercepted so a click from Overview opens it over the page instead of
 * navigating away. A hard load of the same URL is NOT intercepted and renders the full page at
 * app/(app)/people/[userId]/page.tsx — that is what keeps the link shareable. Both render the
 * same PersonDayContent from the same loader, so they cannot drift apart.
 *
 * No SetPageTitle (the header keeps Overview's title — Overview is still the page) and no
 * "← Back" link (the drawer has its own close). Server Component: the token stays here.
 */
export default async function InterceptedPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string; panel?: string }>;
}) {
  const { userId } = await params;
  const session = await getSession();
  // Same reasoning as the full page: the (app) layout's redirect does not re-run on a
  // client-side navigation, so this gates on its own.
  if (!session) redirect(refreshBackTo(`/people/${userId}`));

  const { date: rawDate, panel: rawPanel } = await searchParams;
  const day = await loadPersonDay({ token: session.accessToken, userId, rawDate, rawPanel });

  return (
    <RouteDrawer title={day.title} size="wide">
      <PersonDayContent day={day} />
    </RouteDrawer>
  );
}
