'use client';

import { useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { Avatar } from '../../../components/ui/Avatar';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { buttonClasses } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Drawer } from '../../../components/ui/Drawer';
import { Table, THead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { formatHours, statusBadge, wasAutoDecided, weekLabel } from '../../../lib/approvals-view';
import { toApprovalDetail } from '../../../lib/approvals-drawer-view';
import { DecideForm } from './DecideForm';
import { DrawerDecideForm } from './DrawerDecideForm';
import type { TimesheetApproval } from '@timetrack/contracts';

// Maps statusBadge's tone vocabulary onto the shared Badge component's tone vocabulary.
const TONE: Record<'neutral' | 'positive' | 'warning', BadgeTone> = {
  neutral: 'neutral',
  positive: 'good',
  warning: 'warning',
} as const;

/**
 * True when a row click started on something interactive inside it: the name button (which
 * opens this same drawer, so this mostly guards against double-handling), and the Decide
 * popover's button/form/inputs — `position: fixed`, but still a DOM descendant of the row it's
 * anchored to.
 */
function startedOnInteractive(target: EventTarget | null): boolean {
  return !!(
    target instanceof Element &&
    target.closest('a,button,input,select,textarea,form,label,[role="dialog"]')
  );
}

/**
 * The approvals table, client-side so it can own which row's week drawer is open. Renders the
 * same markup `approvals/page.tsx` used to render inline; that Server Component now just fetches
 * `rows` and hands them here.
 */
export function ApprovalsTable({ rows }: { rows: TimesheetApproval[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openRow = rows.find((r) => r.id === openId) ?? null;
  // Closing on a decide-success (DrawerDecideForm's onDecided) and losing the row to a
  // revalidate that filters it out of the current tab both land here: openRow becomes null and
  // the Drawer renders `open={false}`.
  const detail = openRow ? toApprovalDetail(openRow) : null;

  return (
    <>
      <Card padding="none" className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <Th>User</Th>
              <Th>Week</Th>
              <Th align="right">Hours</Th>
              <Th>Status</Th>
              <Th align="right">Decision</Th>
            </tr>
          </THead>
          <Tbody>
            {rows.map((row) => {
              const badge = statusBadge(row.status);
              return (
                <Tr
                  key={row.id}
                  interactive
                  onClick={(e: MouseEvent<HTMLTableRowElement>) => {
                    if (startedOnInteractive(e.target)) return;
                    setOpenId(row.id);
                  }}
                >
                  <Td>
                    <span className="inline-flex items-center gap-2.5">
                      <Avatar name={row.userName} size={28} />
                      <button
                        type="button"
                        onClick={() => setOpenId(row.id)}
                        className="text-text text-left font-bold"
                      >
                        {row.userName}
                      </button>
                    </span>
                  </Td>
                  <Td className="text-text-secondary tt-numeric">{weekLabel(row.periodStart)}</Td>
                  <Td align="right" className="font-bold">
                    {formatHours(row.totalSeconds ?? row.trackedSeconds)}
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={TONE[badge.tone]}>{badge.label}</Badge>
                      {wasAutoDecided(row) ? (
                        <span
                          className="text-text-secondary text-caption"
                          title="Approved automatically after the grace period — no manager reviewed it. You can still flag it."
                        >
                          automatically
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  <Td align="right">
                    <DecideForm approvalId={row.id} />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Card>

      <Drawer
        open={detail !== null}
        onClose={() => setOpenId(null)}
        title={detail?.userName ?? ''}
        footer={
          detail ? (
            <DrawerDecideForm approvalId={detail.id} onDecided={() => setOpenId(null)} />
          ) : undefined
        }
      >
        {detail ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Avatar name={detail.userName} size={36} />
              <div>
                <div className="text-body font-bold">{detail.userName}</div>
                <div className="text-text-secondary text-caption">{detail.weekLabel}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge tone={TONE[detail.badge.tone]}>{detail.badge.label}</Badge>
              {detail.autoDecided ? (
                <span
                  className="text-text-secondary text-caption"
                  title="Approved automatically after the grace period — no manager reviewed it. You can still flag it."
                >
                  automatically
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <div>
                <span className="text-text-secondary text-caption">Tracked</span>{' '}
                <span className="font-bold">{detail.trackedHours}</span>
              </div>
              {detail.decidedHours !== null ? (
                <div>
                  {/* "Decided as", not "Approved as" — this snapshot is pinned for a FLAGGED
                      row too, and that badge already says whether it was an approval. */}
                  <span className="text-text-secondary text-caption">Decided as</span>{' '}
                  <span className="font-bold">{detail.decidedHours}</span>
                </div>
              ) : null}
              {detail.driftSeconds !== null ? (
                <div className="text-text-secondary text-caption">
                  {detail.driftSeconds > 0
                    ? `${formatHours(detail.driftSeconds)} tracked since the decision`
                    : `${formatHours(Math.abs(detail.driftSeconds))} removed since the decision`}
                </div>
              ) : null}
            </div>

            {detail.decidedAtLabel ? (
              <div>
                <span className="text-text-secondary text-caption">Decided</span>{' '}
                <span>{detail.decidedAtLabel}</span>
              </div>
            ) : null}

            <div>
              <div className="text-text-secondary text-caption mb-1">Note</div>
              <p className="text-body">{detail.note ?? 'No note'}</p>
            </div>

            <Link href={detail.weekHref} className={buttonClasses('secondary', 'sm')}>
              Open {detail.userName.split(' ')[0]}’s week
            </Link>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
