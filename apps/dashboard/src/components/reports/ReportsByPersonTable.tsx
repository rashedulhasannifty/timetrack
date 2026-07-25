'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { Card } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { formatDuration } from '../../lib/format';
import { sortTeamRows } from '../../lib/reports-view';

type SortKey = 'name' | 'trackedSeconds' | 'activityPct';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Clickable column header showing the current sort affordance (⇅ idle, ↑/↓ active). */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
  width,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
  width?: number;
}) {
  const active = sort.key === sortKey;
  const affordance = active ? (sort.dir === 'asc' ? '↑' : '↓') : '⇅';
  return (
    <th
      scope="col"
      className="text-caption text-text-secondary border-separator border-b px-[18px] py-3 font-semibold"
      style={{ textAlign: align, ...(width !== undefined ? { width } : {}) }}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1"
      >
        {label} <span aria-hidden="true">{affordance}</span>
      </button>
    </th>
  );
}

/** Sortable, clickable "By person" table for the Reports page. Rows navigate to /people/[userId]. */
export function ReportsByPersonTable({ rows }: { rows: TeamSummaryRow[] }) {
  const [sort, setSort] = useState<Sort>({ key: 'trackedSeconds', dir: 'desc' });
  const router = useRouter();
  const sorted = sortTeamRows(rows, sort.key, sort.dir);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <SortHeader label="User" sortKey="name" sort={sort} onSort={handleSort} align="left" />
            <SortHeader
              label="Tracked time"
              sortKey="trackedSeconds"
              sort={sort}
              onSort={handleSort}
              align="right"
            />
            <SortHeader
              label="Activity %"
              sortKey="activityPct"
              sort={sort}
              onSort={handleSort}
              align="right"
              width={220}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.userId}
              onClick={() => router.push(`/people/${row.userId}`)}
              className="cursor-pointer"
            >
              <td className="border-separator px-[18px] py-[11px] border-b">
                <span className="inline-flex items-center gap-2">
                  <Avatar name={row.name} size={26} />
                  {row.name}
                </span>
              </td>
              <td className="border-separator tt-numeric px-[18px] py-[11px] border-b text-right">
                {formatDuration(row.trackedSeconds)}
              </td>
              <td className="border-separator px-[18px] py-[11px] border-b">
                <div className="flex items-center justify-end gap-2.5">
                  <div className="bg-separator h-[6px] max-w-[120px] flex-1 overflow-hidden rounded-[3px]">
                    <div
                      className="h-full"
                      style={{ width: `${row.activityPct}%`, background: 'var(--tt-accent)' }}
                    />
                  </div>
                  <span className="tt-numeric w-[38px] text-right">{row.activityPct}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
