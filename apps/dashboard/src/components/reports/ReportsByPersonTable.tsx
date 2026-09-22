'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { Card } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { Meter } from '../ui/Meter';
import { DataTable, type Column } from '../ui/DataTable';
import { formatDuration } from '../../lib/format';

const columns: Column<TeamSummaryRow>[] = [
  {
    key: 'name',
    header: 'User',
    sortBy: (r) => r.name,
    render: (r) => (
      <span className="inline-flex items-center gap-2.5">
        <Avatar name={r.name} size={28} />
        {/* A real link so the row is reachable by keyboard; the row click is the mouse shortcut. */}
        <Link href={`/people/${r.userId}`} className="text-text hover:text-accent font-bold">
          {r.name}
        </Link>
      </span>
    ),
  },
  {
    key: 'tracked',
    header: 'Tracked time',
    align: 'right',
    sortBy: (r) => r.trackedSeconds,
    render: (r) => <span className="font-bold">{formatDuration(r.trackedSeconds)}</span>,
  },
  {
    key: 'activity',
    header: 'Activity %',
    align: 'right',
    sortBy: (r) => r.activityPct,
    render: (r) => (
      <span className="ml-auto flex items-center gap-2.5 w-[220px]">
        <Meter pct={r.activityPct} label={`${r.name} activity`} />
        <span className="tt-numeric text-text-secondary w-9 text-right">{r.activityPct}%</span>
      </span>
    ),
  },
];

/** Sortable, clickable "By person" table for the Reports page. Rows navigate to /people/[userId]. */
export function ReportsByPersonTable({ rows }: { rows: TeamSummaryRow[] }) {
  const router = useRouter();

  return (
    <Card padding="none" className="overflow-hidden">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.userId}
        initialSort={{ key: 'tracked', dir: 'desc' }}
        onRowClick={(r) => router.push(`/people/${r.userId}`)}
        empty={{ title: 'No tracked time in this range' }}
      />
    </Card>
  );
}
