'use client';

import { useRouter } from 'next/navigation';
import { Table, THead, Tbody, Tr, Th, Td } from '../ui/Table';
import { Avatar } from '../ui/Avatar';
import { formatDuration } from '../../lib/format';
import type { PeopleRow } from '../../lib/overview-view';

/**
 * The overview's people table. One row per person with the whole range in it — hours, how
 * active, how that time was categorized, and how much of it was idle — which is what replaced
 * the five separate "top N users" panels: a leaderboard answers "who is highest", a table
 * answers that and everything after it. Rows open that person's day view.
 */
export function PeopleTable({ rows }: { rows: PeopleRow[] }) {
  const router = useRouter();

  if (rows.length === 0) {
    return <p className="text-text-secondary text-body px-[22px] py-5">No people in this range.</p>;
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th>Person</Th>
          <Th align="right">Tracked</Th>
          <Th>Activity</Th>
          <Th>Productive / unproductive</Th>
          <Th align="right">Idle</Th>
        </Tr>
      </THead>
      <Tbody>
        {rows.map((row) => (
          <Tr key={row.userId} interactive onClick={() => router.push(`/people/${row.userId}`)}>
            <Td>
              <span className="inline-flex items-center gap-2.5">
                <Avatar name={row.name} size={26} />
                <span className="text-text font-medium">{row.name}</span>
                {row.tracking ? (
                  <span className="text-recording text-caption inline-flex items-center gap-1.5">
                    <span className="bg-recording tt-pulse h-[7px] w-[7px] flex-none rounded-full" />
                    tracking now
                  </span>
                ) : null}
              </span>
            </Td>
            <Td align="right" className="font-medium">
              {formatDuration(row.trackedSeconds)}
            </Td>
            <Td className="w-[150px]">
              <span className="flex items-center gap-2">
                <span className="bg-separator relative h-[5px] flex-1 overflow-hidden rounded-[3px]">
                  <span
                    className="bg-accent absolute inset-y-0 left-0 rounded-[3px]"
                    style={{ width: `${row.activityPct}%` }}
                  />
                </span>
                <span className="tt-numeric text-text-secondary w-8 text-right">
                  {row.activityPct}%
                </span>
              </span>
            </Td>
            <Td className="w-[230px]">
              <span className="flex items-center gap-2">
                {/* One track, two segments: the gap between them is neutral time, which is why
                    the pair is shown together rather than as two independent meters. */}
                <span className="bg-separator flex h-[5px] flex-1 overflow-hidden rounded-[3px]">
                  <span className="bg-good" style={{ width: `${row.productivePct}%` }} />
                  <span
                    className="bg-category-unproductive"
                    style={{ width: `${row.unproductivePct}%` }}
                  />
                </span>
                <span className="tt-numeric text-text-secondary w-[52px] text-right">
                  {row.productivePct}/{row.unproductivePct}
                </span>
              </span>
            </Td>
            <Td align="right" className="text-text-secondary">
              {row.idlePct}% ({row.idleMinutes}m)
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
