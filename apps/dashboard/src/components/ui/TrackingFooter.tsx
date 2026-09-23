import Link from 'next/link';
import { api, ApiError } from '../../lib/api-client';
import { platformBreakdown } from '../../lib/tracking-breakdown';

/** The card's frame, shared by the live state and the degraded one so they cannot drift. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-raised border-separator shadow-e1 flex flex-col gap-2 rounded-lg border p-3.5">
      {children}
    </div>
  );
}

/**
 * Async server slot: who is tracking right now. Rendered inside <Suspense fallback={null}>.
 *
 * The names come from the same `teamOverview` rows as the count, so the card never claims more
 * people than it can name. What each person is *tracking against* is not on this endpoint —
 * the row carries a user and a seconds total, not a project — so the card lists people only.
 *
 * Three names fit the sidebar's width; the rest are reachable through the "+N more" link rather
 * than expanded in place, because Overview's people table already lists every member with the
 * same live indicator and sorts by the columns you would want. It links to `/overview` and not
 * to an anchor: `Widget` renders `data-widget`, not an `id`, and the people widget can be
 * toggled off in the drawer, so `#people` would be a link to nothing.
 *
 * ONE card with a platform line, not a Mac card and a Windows card. `platform` is null for any
 * client too old to report one, so a two-card split would need a home for that third state —
 * and "Windows 0" beside someone visibly tracking is a lie the line cannot tell. See
 * `platformBreakdown`, which omits itself until there is something true to say.
 *
 * Two failure modes, deliberately told apart. A 403 (an EMPLOYEE, who has no team-wide
 * visibility) and a 401 (a token the layout is already refreshing) are expected, and the card
 * simply does not belong in that shell — render nothing. Anything else is a fault, and it says
 * so. This used to be one bare `catch { return null }`, which meant a response that failed
 * `TeamOverviewSchema` — an API older than the dashboard, exactly what a half-deployed
 * `platform` produces — made the card silently vanish with nothing logged anywhere. It read as
 * a missing feature rather than a broken call, and cost an afternoon.
 *
 * It degrades rather than throwing: this slot sits in the app-wide layout, so an escaping error
 * would take the whole shell down on every page over a decorative card. There is no logger in
 * this app and `no-console` is an error outside `scripts/`, so the visible state IS the signal.
 */
export async function TrackingFooter({ token }: { token: string }) {
  let rows: Awaited<ReturnType<typeof api.teamOverview>>['rows'];
  try {
    rows = (await api.teamOverview(token)).rows;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return null;
    return (
      <Shell>
        <span className="text-caption flex items-center gap-[7px] font-bold">
          <span className="bg-text-secondary h-[7px] w-[7px] flex-none rounded-full opacity-40" />
          Live status unavailable
        </span>
        <span className="text-micro text-text-secondary leading-relaxed">
          Could not reach the API. Tracked time is unaffected.
        </span>
      </Shell>
    );
  }

  const names = rows.filter((r) => r.tracking).map((r) => r.name);
  const count = names.length;
  const listed = names.slice(0, 3).join(', ');
  const rest = count - Math.min(count, 3);
  const breakdown = platformBreakdown(rows);

  return (
    <Shell>
      <span className="text-caption flex items-center gap-[7px] font-bold">
        <span
          className={`bg-accent h-[7px] w-[7px] flex-none rounded-full ${count > 0 ? 'tt-pulse' : 'opacity-40'}`}
        />
        {count} tracking now
      </span>
      {count > 0 ? (
        <span className="text-micro text-text-secondary leading-relaxed">
          {listed}
          {rest > 0 ? (
            <>
              {' '}
              <Link
                href="/overview"
                className="text-accent font-semibold hover:underline"
                aria-label={`See all ${count} people tracking now`}
              >
                +{rest} more
              </Link>
            </>
          ) : null}
        </span>
      ) : (
        <span className="text-micro text-text-secondary leading-relaxed">
          Nobody is tracking right now.
        </span>
      )}
      {breakdown ? (
        <span className="text-text-secondary text-micro opacity-80">{breakdown}</span>
      ) : null}
    </Shell>
  );
}
