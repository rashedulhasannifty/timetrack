'use client';

import Link from 'next/link';
import type { PersonRow } from '../../lib/overview-view';
import { Avatar } from '../ui/Avatar';
import { Meter, SplitMeter } from '../ui/Meter';
import { DataTable, type Column } from '../ui/DataTable';
import { formatDuration } from '../../lib/format';

/**
 * Everyone on the team, one row each, with the numbers that used to be spread across five
 * separate "top 5" cards — tracked time, activity, the productive/unproductive mix and idle.
 * A whole-team table says more than a leaderboard: the person you need to look at is rarely
 * in the top five of anything.
 *
 * Columns whose source call failed render an em dash rather than a zero, so a degraded
 * `team-activity` response never reads as "0% productive".
 */
const columns: Column<PersonRow>[] = [
  {
    key: 'name',
    header: 'Person',
    sortBy: (r) => r.name,
    render: (r) => (
      <Link href={`/people/${r.userId}`} className="text-text flex items-center gap-3">
        <span className="relative inline-flex">
          <Avatar name={r.name} size={28} />
          {r.live ? (
            <span
              aria-label="tracking now"
              className="bg-accent border-surface-raised tt-pulse absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-2"
            />
          ) : null}
        </span>
        <span className="font-bold">{r.name}</span>
      </Link>
    ),
  },
  {
    key: 'tracked',
    header: 'Tracked',
    align: 'right',
    sortBy: (r) => r.trackedSeconds,
    render: (r) => <span className="font-bold">{formatDuration(r.trackedSeconds)}</span>,
  },
  {
    key: 'activity',
    header: 'Activity',
    sortBy: (r) => r.activityPct,
    render: (r) => (
      <span className="flex items-center gap-2.5 w-[170px]">
        <Meter pct={r.activityPct} label={`${r.name} activity`} />
        <span className="tt-numeric text-text-secondary w-8 text-right">{r.activityPct}%</span>
      </span>
    ),
  },
  {
    key: 'mix',
    header: 'Focus mix',
    // Sorts on the productive share; nulls sort last, which is why the accessor returns
    // null rather than 0 for a degraded response.
    sortBy: (r) => r.productivePct,
    render: (r) =>
      r.productivePct === null || r.unproductivePct === null ? (
        <span className="text-neutral">—</span>
      ) : (
        <span className="flex items-center gap-2.5 w-[220px]">
          <SplitMeter
            label={`${r.name}: ${r.productivePct}% productive, ${r.unproductivePct}% unproductive`}
            segments={[
              { pct: r.productivePct, color: 'var(--tt-accent)' },
              {
                pct: r.unproductivePct,
                color: 'var(--tt-category-unproductive)',
                opacity: 0.7,
              },
            ]}
          />
          <span className="tt-numeric text-text-secondary w-14 text-right">
            {r.productivePct}/{r.unproductivePct}
          </span>
        </span>
      ),
  },
  {
    key: 'idle',
    header: 'Idle',
    align: 'right',
    sortBy: (r) => r.idlePct,
    render: (r) => (
      <span className="text-text-secondary">
        {r.idlePct === null ? (
          <span className="text-neutral">—</span>
        ) : (
          `${r.idlePct}% (${r.idleMinutes}m)`
        )}
      </span>
    ),
  },
];

export function PeopleTable({ rows }: { rows: PersonRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.userId}
      initialSort={{ key: 'tracked', dir: 'desc' }}
      empty={{
        title: 'No people tracked time in this range',
        body: 'Pick a wider date range, or check that clients are installed and tracking.',
      }}
    />
  );
}
