import { RouteDrawer } from '../ui/RouteDrawer';
import { Skeleton } from '../ui/Skeleton';
import { Card } from '../ui/Card';

/**
 * Immediate feedback for a click on a person: the drawer shell opens at once with a sketch of the
 * day view (header, four stat cards, tabs, the day card) while the server renders the real one,
 * which then replaces this in place. It is the same RouteDrawer, so Escape / Close already work
 * (they go back to the underlying page) before the content arrives.
 */
export function PersonDrawerLoading() {
  return (
    <RouteDrawer title="Loading…" size="wide">
      <div className="flex flex-col gap-5" aria-busy="true">
        <div className="flex items-center gap-3.5">
          <Skeleton width={40} height={40} className="rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton width={180} height={22} />
            <Skeleton width={140} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} padding="md" className="flex flex-col gap-3">
              <Skeleton width={70} height={10} />
              <Skeleton width={90} height={28} />
            </Card>
          ))}
        </div>
        <Skeleton width={300} height={30} />
        <Card padding="md" className="flex flex-col gap-3">
          <Skeleton width={120} height={16} />
          <Skeleton height={40} />
          <Skeleton height={12} />
          <Skeleton height={12} />
          <Skeleton height={12} />
        </Card>
      </div>
    </RouteDrawer>
  );
}
