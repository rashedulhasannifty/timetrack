import { api } from '../../lib/api-client';

/**
 * Async server slot: live-tracking count, shown in the header beside the account controls.
 * Rendered inside <Suspense fallback={null}>.
 */
export async function TrackingIndicator({ token }: { token: string }) {
  let count: number;
  try {
    const overview = await api.teamOverview(token);
    count = overview.rows.filter((r) => r.tracking).length;
  } catch {
    return null; // employees (403) or any failure → no indicator
  }
  return (
    <div className="text-caption text-text-secondary flex items-center gap-2 whitespace-nowrap">
      <span className="bg-recording h-[7px] w-[7px] flex-none rounded-full" />
      <span>
        {count} {count === 1 ? 'client' : 'clients'} tracking now
      </span>
    </div>
  );
}
