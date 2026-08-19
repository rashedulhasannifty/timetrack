import Link from 'next/link';
import type { PersonRow } from '../../lib/overview-view';
import { Avatar } from '../ui/Avatar';
import { Meter, SplitMeter } from '../ui/Meter';
import { Table, THead, Tbody, Tr, Th, Td } from '../ui/Table';
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
export function PeopleTable({ rows }: { rows: PersonRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-secondary text-body px-[26px] py-5">
        No people tracked time in this range.
      </p>
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <Th>Person</Th>
          <Th align="right">Tracked</Th>
          <Th>Activity</Th>
          <Th>Focus mix</Th>
          <Th align="right">Idle</Th>
        </tr>
      </THead>
      <Tbody>
        {rows.map((r) => (
          <Tr key={r.userId} interactive>
            <Td className="py-[13px]">
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
            </Td>
            <Td align="right" className="font-bold">
              {formatDuration(r.trackedSeconds)}
            </Td>
            <Td className="w-[170px]">
              <span className="flex items-center gap-2.5">
                <Meter pct={r.activityPct} label={`${r.name} activity`} />
                <span className="tt-numeric text-text-secondary w-8 text-right">
                  {r.activityPct}%
                </span>
              </span>
            </Td>
            <Td className="w-[220px]">
              {r.productivePct === null || r.unproductivePct === null ? (
                <span className="text-neutral">—</span>
              ) : (
                <span className="flex items-center gap-2.5">
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
              )}
            </Td>
            <Td align="right" className="text-text-secondary">
              {r.idlePct === null ? (
                <span className="text-neutral">—</span>
              ) : (
                `${r.idlePct}% (${r.idleMinutes}m)`
              )}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
