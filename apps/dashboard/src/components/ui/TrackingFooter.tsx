import Link from 'next/link';
import { api } from '../../lib/api-client';
import { platformBreakdown } from '../../lib/tracking-breakdown';

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
 */
export async function TrackingFooter({ token }: { token: string }) {
  let rows: Awaited<ReturnType<typeof api.teamOverview>>['rows'];
  try {
    rows = (await api.teamOverview(token)).rows;
  } catch {
    return null; // employees (403) or any failure → no footer
  }

  const names = rows.filter((r) => r.tracking).map((r) => r.name);
  const count = names.length;
  const listed = names.slice(0, 3).join(', ');
  const rest = count - Math.min(count, 3);
  const breakdown = platformBreakdown(rows);

  return (
    <div className="bg-surface-raised border-separator shadow-e1 flex flex-col gap-2 rounded-lg border p-3.5">
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
    </div>
  );
}
