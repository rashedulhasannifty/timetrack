'use client';

import { useState } from 'react';
import type { AppUsageItem } from '../../lib/overview-view';
import { Meter } from '../ui/Meter';
import { TabPillTrack, tabPillClasses } from '../ui/TabPills';
import { formatDuration } from '../../lib/format';

const CATEGORY_COLOR: Record<AppUsageItem['category'], string> = {
  PRODUCTIVE: 'var(--tt-accent)',
  NEUTRAL: 'var(--tt-neutral)',
  UNPRODUCTIVE: 'var(--tt-category-unproductive)',
};

type Lists = { All: AppUsageItem[]; Unproductive: AppUsageItem[]; Unrated: AppUsageItem[] };
type TabKey = keyof Lists;
const TABS: TabKey[] = ['All', 'Unproductive', 'Unrated'];

/**
 * Apps and websites, switched between the three cuts the data already carries. Client-side
 * rather than URL-driven: this is one card's local view, and pushing `?apps=` would reload
 * the whole overview to change a five-row list.
 *
 * The bar is coloured by the app's own category, so a card can be scanned for what kind of
 * time it is without reading the tab you are on.
 */
export function AppUsageTabs({ lists }: { lists: Lists }) {
  const [tab, setTab] = useState<TabKey>('All');
  const items = lists[tab];

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-h3 font-bold">Apps &amp; websites</span>
        <TabPillTrack raised={false}>
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
              className={tabPillClasses(tab === k)}
            >
              {k}
            </button>
          ))}
        </TabPillTrack>
      </div>
      {items.length === 0 ? (
        <p className="text-text-secondary text-body pt-3">
          {tab === 'All'
            ? 'No app data in this range.'
            : `Nothing ${tab.toLowerCase()} in this range.`}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((it) => (
            <li key={it.appName} className="border-separator flex items-center gap-3 border-t py-3">
              <span
                aria-hidden="true"
                className="bg-surface border-separator text-text-secondary text-micro inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg border font-extrabold"
              >
                {it.appName.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 truncate text-[13px] font-semibold">{it.appName}</span>
              <Meter pct={it.pct} width={130} color={CATEGORY_COLOR[it.category]} />
              <span className="tt-numeric text-text-secondary w-[60px] text-right text-[13px]">
                {formatDuration(it.seconds)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
