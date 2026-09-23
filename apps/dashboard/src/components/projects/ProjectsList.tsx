'use client';

import { useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { Badge } from '../ui/Badge';
import { buttonClasses, iconButtonClasses } from '../ui/Button';
import { Card } from '../ui/Card';
import { Drawer } from '../ui/Drawer';
import { Meter } from '../ui/Meter';
import { IconInfo } from '../ui/icons';
import { startedOnInteractive } from '../../lib/row-click';
import { formatDuration } from '../../lib/format';
import { ProjectArchiveToggle } from './ProjectArchiveToggle';
import type { ProjectIndexRow } from '../../lib/projects-index-view';

/**
 * The projects index `<ul>`, moved as-is from `projects/page.tsx` so it can own which project's
 * quick-look drawer is open. That Server Component keeps its fetch and now just hands `rows`
 * and the two footer buckets here, plus `rangeLabel` (the page's already-computed kicker text)
 * for the drawer body.
 */
export function ProjectsList({
  rows,
  noProjectSeconds,
  residualSeconds,
  totalSeconds,
  rangeLabel,
}: {
  rows: ProjectIndexRow[];
  noProjectSeconds: number;
  residualSeconds: number;
  totalSeconds: number;
  rangeLabel: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Derived from props, not stored: if the open project's row vanishes from `rows` on a
  // revalidate (e.g. it was archived while "Show archived" is off), `openRow` becomes null on
  // the very next render and the Drawer closes cleanly instead of showing a stale row.
  const openRow = rows.find((r) => r.projectId === openId) ?? null;

  return (
    <>
      {rows.length === 0 ? (
        <p className="text-text-secondary text-body">No projects yet.</p>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <ul className="m-0 flex list-none flex-col p-0">
            {rows.map((row) => (
              <li
                key={row.projectId}
                onClick={(e: MouseEvent<HTMLLIElement>) => {
                  if (startedOnInteractive(e.target)) return;
                  setOpenId(row.projectId);
                }}
                className="border-separator hover:bg-hover flex flex-wrap items-center gap-3.5 border-b px-[26px] py-4 transition-colors"
              >
                <span
                  className="inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
                <Link
                  href={`/projects/${row.projectId}`}
                  className="text-text hover:text-accent min-w-[190px] flex-none truncate text-[14px] font-bold transition-colors"
                >
                  {row.name}
                </Link>
                {row.archived && (
                  <span className="text-text-secondary border-separator text-micro rounded-full border px-2.5 py-0.5">
                    Archived
                  </span>
                )}
                <span className="text-text-secondary text-caption min-w-[130px]">
                  {row.taskCount === 0
                    ? 'no tasks'
                    : `${row.taskCount} ${row.taskCount === 1 ? 'task' : 'tasks'}`}
                </span>
                <Meter pct={row.sharePct} />
                <span className="tt-numeric w-20 shrink-0 text-right text-[13px] font-bold">
                  {formatDuration(row.trackedSeconds)}
                </span>
                <span className="tt-numeric text-neutral w-10 shrink-0 text-right text-caption">
                  {Math.round(row.sharePct)}%
                </span>
                <ProjectArchiveToggle id={row.projectId} archived={row.archived} />
                <button
                  type="button"
                  onClick={() => setOpenId(row.projectId)}
                  aria-label={`Quick look at ${row.name}`}
                  className={iconButtonClasses('sm')}
                >
                  <IconInfo width={16} height={16} />
                </button>
              </li>
            ))}
            {noProjectSeconds > 0 && (
              <li className="text-text-secondary flex flex-wrap items-center gap-3.5 px-[26px] py-4">
                <span
                  className="bg-separator inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <span className="min-w-[190px] flex-none text-[14px]">No project</span>
                <span className="min-w-[130px]" />
                <Meter pct={totalSeconds === 0 ? 0 : (noProjectSeconds / totalSeconds) * 100} />
                <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                  {formatDuration(noProjectSeconds)}
                </span>
                <span className="w-10 shrink-0" />
              </li>
            )}
            {residualSeconds > 0 && (
              <li className="text-text-secondary border-separator flex flex-wrap items-center gap-3.5 border-t px-[26px] py-4">
                <span
                  className="bg-separator inline-block h-[9px] w-[9px] shrink-0 rounded-full"
                  aria-hidden="true"
                />
                <span className="min-w-[190px] flex-none text-[14px]">Projects not listed</span>
                <span className="text-caption min-w-[130px]">
                  archived — turn on “Show archived”
                </span>
                <Meter pct={totalSeconds === 0 ? 0 : (residualSeconds / totalSeconds) * 100} />
                <span className="tt-numeric w-20 shrink-0 text-right text-[13px]">
                  {formatDuration(residualSeconds)}
                </span>
                <span className="w-10 shrink-0" />
              </li>
            )}
          </ul>
        </Card>
      )}

      <Drawer
        open={openRow !== null}
        onClose={() => setOpenId(null)}
        title={openRow?.name ?? ''}
        footer={
          openRow ? (
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/projects/${openRow.projectId}`}
                className={buttonClasses('primary', 'sm')}
              >
                Open project
              </Link>
              <ProjectArchiveToggle id={openRow.projectId} archived={openRow.archived} />
            </div>
          ) : undefined
        }
      >
        {openRow ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: openRow.color }}
                aria-hidden="true"
              />
              <span className="text-body font-bold">{openRow.name}</span>
              {openRow.archived ? <Badge tone="neutral">Archived</Badge> : null}
            </div>

            <div className="text-text-secondary text-caption">{rangeLabel}</div>

            <div className="flex flex-col gap-2">
              <div>
                <span className="text-text-secondary text-caption">Tracked</span>{' '}
                <span className="font-bold">{formatDuration(openRow.trackedSeconds)}</span>
              </div>
              <Meter
                pct={openRow.sharePct}
                label={`${Math.round(openRow.sharePct)}% of tracked time in this range`}
              />
              <div className="text-text-secondary text-caption">
                {Math.round(openRow.sharePct)}% of tracked time in this range
              </div>
            </div>

            <div>
              <div className="text-text-secondary text-caption mb-1">Tasks</div>
              {openRow.tasks.length === 0 ? (
                <p className="text-body">No tasks yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {openRow.tasks.map((task) => (
                    <li key={task.id} className="text-body">
                      {task.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
