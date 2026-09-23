'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { Drawer } from '../ui/Drawer';
import { CategoryMixBar } from './CategoryMixBar';
import { startedOnInteractive } from '../../lib/row-click';
import { formatDuration, formatTimeRange } from '../../lib/format';
import type { DayEntryRow } from '../../lib/person-day-view';

function rangeOf(e: DayEntryRow): string {
  return formatTimeRange(
    new Date(e.startMs).toISOString(),
    e.endMs === null ? null : new Date(e.endMs).toISOString(),
  );
}

/**
 * The day's entry list plus a read-only detail drawer for one entry. `TimeEntriesList` (a
 * Server Component) renders this and hands it each row's edit/delete controls already rendered,
 * keyed by entry id — a per-row render function cannot cross into a client component.
 *
 * The drawer is not portalled on purpose: on Overview this list sits inside the person
 * RouteDrawer's panel, which treats an inner `aria-modal` as owning Escape and the Tab trap, so
 * one Escape closes only the entry and the next closes the person.
 */
export function TimeEntriesDrawerList({
  entries,
  actions,
}: {
  entries: DayEntryRow[];
  /** Edit/delete per entry id, supplied only where the viewer may change this record. */
  // `| undefined` explicitly: exactOptionalPropertyTypes (TS2375) — the adapter forwards it.
  actions?: Record<string, ReactNode> | undefined;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Derived from props, not stored: an entry deleted (or moved off this day) by a revalidate
  // closes the drawer instead of leaving a stale entry showing.
  const open = entries.find((e) => e.id === openId) ?? null;

  if (entries.length === 0) {
    return <p className="text-text-secondary text-body">No entries in range.</p>;
  }
  return (
    <>
      <ul className="flex flex-col">
        {entries.map((e) => (
          <li
            key={e.id}
            onClick={(ev: MouseEvent<HTMLLIElement>) => {
              // The row's edit/delete controls (and their open inline form) must not open it.
              if (startedOnInteractive(ev.target)) return;
              setOpenId(e.id);
            }}
            className="border-separator hover:bg-hover flex cursor-pointer items-center gap-3.5 border-b py-3 transition-colors"
          >
            <span className="tt-numeric w-[132px] flex-none text-[13px] text-text-secondary">
              {rangeOf(e)}
            </span>
            <span className="bg-category-neutral h-[9px] w-[9px] flex-none rounded-full" />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setOpenId(e.id)}
                className="hover:text-accent max-w-full cursor-pointer truncate text-left text-[13px] transition-colors"
              >
                {e.label}
              </button>
            </div>
            <span className="tt-numeric flex-none text-[13px]">
              {e.running ? 'running' : formatDuration(e.durationSeconds)}
            </span>
            {actions?.[e.id]}
          </li>
        ))}
      </ul>

      <Drawer open={open !== null} onClose={() => setOpenId(null)} title={open?.label ?? ''}>
        {open ? <EntryDetail entry={open} /> : null}
      </Drawer>
    </>
  );
}

function EntryDetail({ entry }: { entry: DayEntryRow }) {
  const { activity } = entry;
  return (
    <div className="flex flex-col gap-5">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
        <dt className="text-text-secondary text-caption self-center">Time</dt>
        <dd className="tt-numeric m-0">
          {rangeOf(entry)} ·{' '}
          <span className="font-bold">
            {entry.running ? 'running' : formatDuration(entry.durationSeconds)}
          </span>
        </dd>
        <dt className="text-text-secondary text-caption self-center">Project</dt>
        <dd className="m-0">{entry.projectName ?? 'No project'}</dd>
        {entry.taskName ? (
          <>
            <dt className="text-text-secondary text-caption self-center">Task</dt>
            <dd className="m-0">{entry.taskName}</dd>
          </>
        ) : null}
        {entry.note ? (
          <>
            <dt className="text-text-secondary text-caption self-center">Note</dt>
            <dd className="m-0 whitespace-pre-wrap">{entry.note}</dd>
          </>
        ) : null}
        <dt className="text-text-secondary text-caption self-center">Source</dt>
        <dd className="m-0">
          {entry.source === 'MANUAL' ? 'Added by hand' : 'Tracked by the app'}
        </dd>
      </dl>

      <section className="border-separator flex flex-col gap-4 border-t pt-4">
        <div className="text-text-secondary text-caption font-bold">During this entry</div>
        {activity.mix.sampled === 0 ? (
          <p className="text-text-secondary text-caption m-0">
            No activity recorded during this entry.
          </p>
        ) : (
          <>
            <div>
              <span className="text-text-secondary text-caption">Active</span>{' '}
              <span className="tt-numeric font-bold">{activity.activePct}%</span>
            </div>
            <CategoryMixBar mix={activity.mix} />
            <div>
              <div className="text-text-secondary text-caption mb-1.5">Top apps</div>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {activity.topApps.map((a) => (
                  <li key={a.app} className="flex items-center justify-between gap-3 text-body">
                    <span className="min-w-0 truncate">{a.app}</span>
                    <span className="tt-numeric text-text-secondary flex-none">
                      {formatDuration(a.minutes * 60)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
