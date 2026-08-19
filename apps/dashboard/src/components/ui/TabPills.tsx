import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The redesign's tab control: a pill track holding one pill per option, the active one filled
 * with the accent tint. Used for Admin sections, Approvals status, the My-time panels and the
 * Apps category switch.
 *
 * Link-based by default so tab state survives a reload and stays shareable — these all map to a
 * URL today (`?status=`, `/admin/*`). `TabPillTrack` + `tabPillClasses` are exported for the one
 * case that cannot be a link (a purely client-side switch with no URL to point at).
 */
export function tabPillClasses(active: boolean): string {
  return `rounded-full px-[13px] py-[5px] text-caption font-bold transition-colors ${
    active ? 'bg-tint text-accent' : 'text-text-secondary hover:text-text'
  }`;
}

export function TabPillTrack({
  children,
  raised = true,
  className = '',
}: {
  children: ReactNode;
  /** Raised = the bordered card-like track (page-level tabs). Sunken = inside a card header. */
  raised?: boolean;
  className?: string;
}) {
  const shell = raised ? 'bg-surface-raised border-separator border shadow-e1' : 'bg-surface';
  return (
    <div className={`inline-flex gap-0.5 rounded-full p-[3px] ${shell} ${className}`.trim()}>
      {children}
    </div>
  );
}

export type TabItem = { href: string; label: string; count?: number | null };

export function TabPills({
  tabs,
  activeHref,
  raised = true,
  className = '',
  ariaLabel,
}: {
  tabs: ReadonlyArray<TabItem>;
  /** The href of the tab to mark current. Compare on the caller's terms (exact, prefix, query). */
  activeHref: string;
  raised?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel}>
      <TabPillTrack raised={raised} className={className}>
        {tabs.map((tab) => {
          const active = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={tabPillClasses(active)}
            >
              {tab.label}
              {tab.count ? <span className="tt-numeric ml-1.5">{tab.count}</span> : null}
            </Link>
          );
        })}
      </TabPillTrack>
    </nav>
  );
}
