import { TabPills, type TabItem } from '../ui/TabPills';

export const DAY_PANELS = ['timeline', 'activity', 'screenshots', 'idle'] as const;
export type DayPanel = (typeof DAY_PANELS)[number];

export function resolveDayPanel(raw: string | undefined): DayPanel {
  return (DAY_PANELS as readonly string[]).includes(raw ?? '') ? (raw as DayPanel) : 'timeline';
}

/**
 * The four panels of a day view, shared by `/me` and `people/[userId]` so a manager reads a
 * person's day in exactly the shape the person reads their own.
 *
 * URL-driven (`?panel=`) rather than client state, so a panel is shareable, survives a reload
 * and stays server-rendered — the day's data is already fetched on the server and none of it
 * belongs in a client bundle. `basePath` is what makes the same control work on both routes.
 *
 * Note for e2e: only the ACTIVE panel is in the DOM; the others live in the RSC flight payload.
 * Assert against a panel by navigating to its `?panel=` rather than expecting all four at once.
 */
export function DayTabs({
  panel,
  date,
  basePath,
}: {
  panel: DayPanel;
  date: string;
  basePath: string;
}) {
  const href = (p: DayPanel): string => `${basePath}?date=${date}&panel=${p}`;
  const tabs: TabItem[] = [
    { href: href('timeline'), label: 'Timeline' },
    { href: href('activity'), label: 'Activity' },
    { href: href('screenshots'), label: 'Screenshots' },
    { href: href('idle'), label: 'Idle' },
  ];
  return <TabPills tabs={tabs} activeHref={href(panel)} ariaLabel="Day panels" />;
}
