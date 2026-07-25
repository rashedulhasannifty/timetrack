import { api } from '../../lib/api-client';

/** Async server slot: live-tracking count. Rendered inside <Suspense fallback={null}>. */
export async function TrackingFooter({ token }: { token: string }) {
  let count: number;
  try {
    const overview = await api.teamOverview(token);
    count = overview.rows.filter((r) => r.tracking).length;
  } catch {
    return null; // employees (403) or any failure → no footer
  }
  return (
    <div className="text-caption text-text-secondary flex items-center gap-2">
      <span className="bg-recording h-[7px] w-[7px] flex-none rounded-full" />
      <span>
        {count} {count === 1 ? 'client' : 'clients'} tracking now
      </span>
    </div>
  );
}
