'use client';

import { useState, type ReactNode } from 'react';

const TABS = ['Timeline', 'Activity', 'Screenshots', 'Idle'] as const;
type Tab = (typeof TABS)[number];

export function MeTabs({ panels }: { panels: Record<Tab, ReactNode> }) {
  const [active, setActive] = useState<Tab>('Timeline');
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 border-b border-neutral-200" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={
              active === tab
                ? 'border-b-2 border-neutral-900 px-3 py-2 text-sm font-medium text-neutral-900'
                : 'px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800'
            }
          >
            {tab}
          </button>
        ))}
      </nav>
      <div role="tabpanel">{panels[active]}</div>
    </div>
  );
}
