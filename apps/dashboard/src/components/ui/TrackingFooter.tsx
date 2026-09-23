import { api } from '../../lib/api-client';

/**
 * Async server slot: who is tracking right now. Rendered inside <Suspense fallback={null}>.
 *
 * The names come from the same `teamOverview` rows as the count, so the card never claims more
 * people than it can name. What each person is *tracking against* is not on this endpoint —
 * the row carries a user and a seconds total, not a project — so the card lists people only.
 *
 * Deliberately platform-neutral. `tracking` is an EXISTS on an open, heartbeating `time_entries`
 * row (reports.repository.ts) with no OS filter, and the Windows client publishes and heartbeats
 * open entries exactly as the Mac one does — so this counts both. The copy here used to name the
 * Mac app, which read as "Windows is not tracked" when nothing was running. Nothing in the
 * schema records a client platform (no Device row; `RefreshToken` carries no OS column), so
 * there is no per-platform count to show even if we wanted one — do not reintroduce one here.
 */
export async function TrackingFooter({ token }: { token: string }) {
  let names: string[];
  try {
    const overview = await api.teamOverview(token);
    names = overview.rows.filter((r) => r.tracking).map((r) => r.name);
  } catch {
    return null; // employees (403) or any failure → no footer
  }

  const count = names.length;
  const listed = names.slice(0, 3).join(', ');
  const rest = count - Math.min(count, 3);

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
          {rest > 0 ? ` +${rest} more` : ''}
        </span>
      ) : (
        <span className="text-micro text-text-secondary leading-relaxed">
          Nobody is tracking right now.
        </span>
      )}
    </div>
  );
}
