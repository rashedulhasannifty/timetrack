'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TeamSummaryRow } from '@timetrack/contracts';
import { Card } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { Table, THead, Tbody, Tr, Th, Td } from '../ui/Table';
import { BarMeter } from '../charts/BarMeter';
import { formatDuration } from '../../lib/format';
import { sortTeamRows } from '../../lib/reports-view';

type SortKey = 'name' | 'trackedSeconds' | 'activityPct';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

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

  const dirFor = (key: SortKey): 'asc' | 'desc' | null => (sort.key === key ? sort.dir : null);

  return (
    <Card padding="none" className="overflow-hidden">
      <Table>
        <THead>
          <Tr>
            <Th sortable sortDirection={dirFor('name')} onSortClick={() => handleSort('name')}>
              User
            </Th>
            <Th
              align="right"
              sortable
              sortDirection={dirFor('trackedSeconds')}
              onSortClick={() => handleSort('trackedSeconds')}
            >
              Tracked time
            </Th>
            <Th
              align="right"
              sortable
              sortDirection={dirFor('activityPct')}
              onSortClick={() => handleSort('activityPct')}
            >
              Activity %
            </Th>
          </Tr>
        </THead>
        <Tbody>
          {sorted.map((row) => (
            <Tr key={row.userId} interactive onClick={() => router.push(`/people/${row.userId}`)}>
              <Td>
                <span className="inline-flex items-center gap-2">
                  <Avatar name={row.name} size={26} />
                  {row.name}
                </span>
              </Td>
              <Td align="right">{formatDuration(row.trackedSeconds)}</Td>
              <Td align="right" className="w-[220px]">
                <BarMeter
                  label=""
                  value={`${row.activityPct}%`}
                  fills={[{ pct: row.activityPct, color: 'var(--tt-accent)' }]}
                />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  );
}
