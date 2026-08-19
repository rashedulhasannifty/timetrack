import Link from 'next/link';
import type { ProjectShare } from '../../lib/overview-view';
import { Meter } from '../ui/Meter';
import { formatDuration } from '../../lib/format';

/** Projects as shares of the range's tracked time. Rails are scaled to the largest share. */
export function ProjectShareList({ shares }: { shares: ProjectShare[] }) {
  if (shares.length === 0) {
    return <p className="text-text-secondary text-body pt-3">No project data in this range.</p>;
  }
  const top = Math.max(...shares.map((s) => s.sharePct), 1);
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {shares.map((s) => (
        <li
          key={s.projectId ?? 'none'}
          className="border-separator flex items-center gap-3 border-t py-3"
        >
          <span className="flex-1 truncate text-[13px] font-semibold">
            {s.projectId ? (
              <Link href={`/projects/${s.projectId}`} className="text-text">
                {s.name}
              </Link>
            ) : (
              <span className="text-text-secondary">{s.name}</span>
            )}
          </span>
          <Meter pct={(s.sharePct / top) * 100} width={150} />
          <span className="tt-numeric text-text-secondary w-[70px] text-right text-[13px]">
            {formatDuration(s.trackedSeconds)}
          </span>
          <span className="tt-numeric text-neutral w-10 text-right text-caption">
            {Math.round(s.sharePct)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
