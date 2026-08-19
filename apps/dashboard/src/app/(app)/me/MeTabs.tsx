import { TabPills, type TabItem } from '../../../components/ui/TabPills';

export const ME_PANELS = ['timeline', 'activity', 'screenshots', 'idle'] as const;
export type MePanel = (typeof ME_PANELS)[number];

export function resolveMePanel(raw: string | undefined): MePanel {
  return (ME_PANELS as readonly string[]).includes(raw ?? '') ? (raw as MePanel) : 'timeline';
}

/**
 * The four panels of My time. URL-driven (`?panel=`) rather than client state, so a panel is
 * shareable, survives a reload, and stays server-rendered — the day's data is already fetched
 * server-side and none of it belongs in a client bundle.
 *
 * The date is carried through so switching panels doesn't silently jump you back to today.
 */
export function MeTabs({ panel, date }: { panel: MePanel; date: string }) {
  const href = (p: MePanel): string => `/me?date=${date}&panel=${p}`;
  const tabs: TabItem[] = [
    { href: href('timeline'), label: 'Timeline' },
    { href: href('activity'), label: 'Activity' },
    { href: href('screenshots'), label: 'Screenshots' },
    { href: href('idle'), label: 'Idle' },
  ];
  return <TabPills tabs={tabs} activeHref={href(panel)} ariaLabel="My time panels" />;
}
